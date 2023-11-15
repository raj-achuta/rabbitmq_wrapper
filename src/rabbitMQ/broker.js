'use strict';

import 'core-js/stable';
import 'regenerator-runtime/runtime';
import {encode, decode} from '.';
import amqp from 'amqplib';

const DEAFULT_CONN_RECOVERY_TIMEOUT_IN_MS = 10000; // 10 sec
const DEFAULT_DELAY_TIMEOUT_IN_MS = 300000; // 5 min
const DEFAULT_MESSAGE_TTL = 300000; // 5 min
const DEAFULT_MAX_RETRY_COUNT = 3;
const DELAY_KEY = 'delay';
const DLQ_KEY = 'dead';
const PRIMARY_KEY = 'primary';

const DELAY_HEADER = 'x-delay';
const MAX_RETRY_HEADER = 'x-max-retry';
const RETRY_HEADER = 'x-retry-count';

const getDeadLetterQueueName = function(name) {
  return `${name}.dlq`;
};

const getDelayQueueName = function(name) {
  return `${name}.delay`;
};

const getExchangeName = function(name) {
  return `${name}.exchange`;
};
class Broker {
  #config;
  #connectionRecoveryTimeout;
  #isConnected;
  #isSubscriberChannelRunning;
  #isPublisherChannelRunning;
  #consumers;
  #connectionRetryCounter;
  #logger;
  #shouldReconnect;

  constructor() {
    this.#connectionRecoveryTimeout = DEAFULT_CONN_RECOVERY_TIMEOUT_IN_MS;
    this.#config = {};
    this.#isConnected = false;
    this.#isSubscriberChannelRunning = false;
    this.#isPublisherChannelRunning = false;
    this.#consumers = [];
    this.#connectionRetryCounter = 0;
    this.#shouldReconnect = true;
    this.#logger = console;
  }

  setConfig(config) {
    this.#config = config;
    return this;
  }

  setConnectionRecoveryTimeout(timeout) {
    this.#connectionRecoveryTimeout = timeout;
    return this;
  }

  setLogger(logger) {
    this.#logger = logger;
    return this;
  }

  async build() {
    if (this.#config === {}) {
      throw new Error('Invalid RabbitMQ config, set config using setConfig');
    }
    await this.#init();
    return this;
  }

  async #init() {
    await this.#start();
    await this.#createChannels();
  }

  async #start() {
    if (this.#isConnected) {
      return;
    }

    try {
      this.connection = await amqp.connect(this.#config);
      this.#logger.info('Connected to RabbitMQ server!!');
      this.#isConnected = true;
      this.#connectionRetryCounter = 0;

      this.connection.on('error', (err) => {
        this.#logger.error(`Connection closed with error: ${err}`);
        // `close` event is emitted after `error` event
        // so, noop other than logging.
      });

      this.connection.on('close', async () => {
        this.#isConnected = false;
        this.#isSubscriberChannelRunning = false;
        this.#isPublisherChannelRunning = false;
        this.connection.removeAllListeners();
        this.#logger.info('Connection is closed, retrying.');
        this.#reconnect();
      });
    } catch (err) {
      this.#logger.error(`Unable to connect to RabbitMQ server: ${err}`);
      this.#reconnect();
    }
  }

  #reconnect() {
    if (!this.#shouldReconnect) {
      return;
    }

    const timeout =
      2 ** (this.#connectionRetryCounter++) * this.#connectionRecoveryTimeout;
    setTimeout(() => {
      this.build();
    }, timeout);
  }

  close(shouldReconnect = true) {
    this.#isConnected = false;
    this.#shouldReconnect = shouldReconnect;
    if (this.#isPublisherChannelRunning) {
      this.publisherChannel.close();
    }

    if (this.#isSubscriberChannelRunning) {
      this.subscriberChannel.close();
    }

    this.connection.close();
  }

  async #createChannels() {
    await this.#createSubscriberChannel();
    await this.#createPublisherChannel();
  }

  #restartSubscriberChannel() {
    if (this.#isConnected &&
       !this.#isSubscriberChannelRunning &&
       this.#shouldReconnect) {
      this.#createSubscriberChannel();
    }
  }

  async #createSubscriberChannel() {
    if (this.#isSubscriberChannelRunning || !this.#isConnected) {
      return;
    }

    this.subscriberChannel = await this.#createChannel();

    this.subscriberChannel.on('error', () => {
      this.#logger.error(`Error occured in subscriber channel`);
    });

    this.subscriberChannel.on('close', () => {
      this.#logger.error(`Closing subscriber channel`);
      this.#isSubscriberChannelRunning = false;
      this.subscriberChannel.removeAllListeners();
      this.#restartSubscriberChannel();
    });

    this.#isSubscriberChannelRunning = true;
    this.#logger.info(`Subscriber channel created!!`);

    this.#consumers.forEach((consumer) => {
      this.#buildConsumer(consumer.queue, consumer.handler, consumer.props);
    });
  }

  #restartPublisherChannel() {
    if (this.#isConnected &&
      !this.#isPublisherChannelRunning &&
      this.#shouldReconnect) {
      this.#createPublisherChannel();
    }
  }

  async #createPublisherChannel() {
    if (this.#isPublisherChannelRunning || !this.#isConnected) {
      return;
    }

    this.publisherChannel = await this.#createChannel();

    this.publisherChannel.on('error', () => {
      this.#logger.error(`Error occured in publisher channel`);
    });

    this.publisherChannel.on('close', () => {
      this.#logger.error(`Closing publisher channel`);
      this.#isPublisherChannelRunning = false;
      this.publisherChannel.removeAllListeners();
      this.#restartPublisherChannel();
    });

    this.#isPublisherChannelRunning = true;
    this.#logger.info(`publisher channel created!!`);
  }

  async #createChannel() {
    let channel;
    try {
      channel = await this.connection.createConfirmChannel();
    } catch (err) {
      this.#logger.error(`Unable to create a channel`);
      throw err;
    }

    return channel;
  }

  publish(queue, message, props) {
    if (!(this.#isConnected && this.#isPublisherChannelRunning)) {
      return false;
    }

    const encodedMessage = encode(message, props);
    return this.#publishMessageToExchange(
        getExchangeName(queue), PRIMARY_KEY,
        encodedMessage.buffer, encodedMessage.props);
  }

  #publishMessageToExchange(exchange, key, messageInBuffer, props) {
    return this.publisherChannel.publish(exchange, key, messageInBuffer, props);
  }

  #assertQueue(queue, props) {
    this.subscriberChannel.assertQueue(queue, props)
        .then((msg) => {
          this.#logger.info(`${queue} created!`);
        }).catch((err) => {
          this.#logger.error(`Error while creating ${queue}: ${err}`);
          throw err;
        });
  }

  #assertExchange(exchange, type, props) {
    this.subscriberChannel.assertExchange(exchange, type, {
      durable: props?.durable || true,
      autoDelete: props?.autoDelete || false,
    }).then((msg) => {
      this.#logger.info(`${exchange} created!`);
    }).catch((err) => {
      this.#logger.error(`Error while creating ${exchange}: ${err}`);
      throw err;
    });
  }

  #bindDirectExchangeWithQueue(exchange, queue, key) {
    this.subscriberChannel.bindQueue(queue, exchange, key);
  }

  #setupQueues(exchange, queue, deadLetterQueue, delayQueue, props) {
    const delayTimeout = props?.headers?.[DELAY_HEADER] ||
      DEFAULT_DELAY_TIMEOUT_IN_MS;
    this.#assertExchange(exchange, 'direct', props);

    this.#assertQueue(queue, {
      ...props,
      durable: props?.durable || true,
      autoDelete: props?.autoDelete || false,
      messageTtl: props?.messageTtl || DEFAULT_MESSAGE_TTL,
      deadLetterExchange: exchange,
      deadLetterRoutingKey: DLQ_KEY,
    });

    this.#assertQueue(deadLetterQueue, {
      durable: true,
      autoDelete: false,
    });

    this.#assertQueue(delayQueue, {
      durable: true,
      autoDelete: false,
      messageTtl: delayTimeout,
      deadLetterExchange: exchange,
      deadLetterRoutingKey: PRIMARY_KEY,
    });

    this.#bindDirectExchangeWithQueue(exchange, deadLetterQueue, DLQ_KEY);
    this.#bindDirectExchangeWithQueue(exchange, delayQueue, DELAY_KEY);
    this.#bindDirectExchangeWithQueue(exchange, queue, PRIMARY_KEY);
  }

  #retryMechanism(message, exchange, maxRetryCount) {
    const props = message.properties || {};
    let key = DELAY_KEY;
    let count = props?.headers?.[RETRY_HEADER] || 0;
    if (++count >= maxRetryCount) {
      key = DLQ_KEY;
    }

    props.headers[RETRY_HEADER] = count;
    this.#publishMessageToExchange(exchange, key, message.content, props);
    // Nacking message will place the message back to original queue
    // and message gets timeout and moved DLQ and casuing duplicate
    // messages in DLQ.
    this.subscriberChannel.ack(message);
  }

  #rejectMechanism(message, exchange) {
    const props = message.properties || {};
    this.#publishMessageToExchange(exchange, DLQ_KEY, message.content, props);
    this.subscriberChannel.ack(message);
  }

  #addConsumerToArrayList(queue, handler, props) {
    this.#consumers.push({
      queue: queue,
      handler: handler,
      props: props,
    });
  }

  consume(queue, handler, props) {
    this.#addConsumerToArrayList(queue, handler, props);
    this.#buildConsumer(queue, handler, props);
  }

  // eslint-disable-next-line require-jsdoc
  #buildConsumer(queue, handler, props) {
    const exchange = getExchangeName(queue);
    const deadLetterQueue = getDeadLetterQueueName(queue);
    const delayQueue = getDelayQueueName(queue);
    const maxRetryCount =
      props?.headers?.[MAX_RETRY_HEADER] || DEAFULT_MAX_RETRY_COUNT;

    this.#setupQueues(exchange, queue, deadLetterQueue, delayQueue, props);
    const consumerHandler = (message) => {
      // Successfully processed the message and deleting it from queue.
      const ackFun = () => this.subscriberChannel.ack(message);
      // Unable to process the message, will retry the message after a delay.
      const nackFun = () =>
        this.#retryMechanism(message, exchange, maxRetryCount);
      // Incorrect message, moving message to DLQ.
      const rejectFun = () => this.#rejectMechanism(message, exchange);
      const decodedMessage = decode(message);
      handler(decodedMessage, message,
          {ack: ackFun, nack: nackFun, reject: rejectFun});
    };
    this.subscriberChannel.prefetch(1);
    this.subscriberChannel.consume(queue, consumerHandler, {
      noAck: false,
    });
  }
}

export {
  Broker,
};
