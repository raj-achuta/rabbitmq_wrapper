import {expect} from 'chai';
import {Broker} from '../../src/rabbitMQ';

jest.setTimeout(30000);

const wait = ((time) => {
  return new Promise((r) => setTimeout(r, time));
});

const getDLQName = (input) => {
  return `${input}.dlq`;
};

const MQ_MAX_RETRY_COUNT_HEADER = 'x-max-retry';
const MQ_RETRY_DELAY_HEADER = 'x-delay';
const MQ_HOST = process.env.MQ_HOST;

describe('RabbitMQ', () => {
  let broker;

  beforeAll(async () => {
    broker = await new Broker()
        .setConnectionRecoveryTimeout(1000)
        .setLogger(console)
        .setConfig(`amqp://guest:guest@${MQ_HOST}:5672`)
        .build();
  });

  test('publish and ack message test', async () => {
    const msg = 'test1_message';
    const msgId = 'test1_1234';
    const queueName = 'test1.queue';
    const sendSMSHandler = jest.fn((m, props, notify) => {
      expect(m).to.be.equal(msg);
      expect(props.properties.messageId).to.be.equal(msgId);
      notify.ack();
    });

    const props = {
      messageTtl: 100,
      headers: {},
    };
    props.headers[MQ_MAX_RETRY_COUNT_HEADER] = 4;
    props.headers[MQ_RETRY_DELAY_HEADER] = 500;

    broker.consume(queueName, sendSMSHandler, props);

    await wait(1000);
    const isPublished = broker.publish(queueName, msg, {
      messageId: msgId,
    });
    expect(isPublished).to.be.true;
    await wait(1000);
    expect(sendSMSHandler.mock.calls.length).to.be.equal(1);
  });

  test('publish and nack retry message test', async () => {
    const msg = 'test2_message';
    const msgId = 'test2_1234';
    const queueName = 'test2.queue';
    const sendSMSHandler = jest.fn((m, props, notify) => {
      expect(m).to.be.equal(msg);
      expect(props.properties.messageId).to.be.equal(msgId);
      notify.nack();
    });

    const props = {
      messageTtl: 100,
      headers: {},
    };
    props.headers[MQ_MAX_RETRY_COUNT_HEADER] = 4;
    props.headers[MQ_RETRY_DELAY_HEADER] = 500;

    broker.consume(queueName, sendSMSHandler, props);

    await wait(1000);
    const isPublished = broker.publish(queueName, msg, {
      messageId: msgId,
    });
    expect(isPublished).to.be.true;
    await wait(5000);
    expect(sendSMSHandler.mock.calls.length).to.be.equal(4);

    const result =
        await broker.subscriberChannel.purgeQueue(getDLQName(queueName));
    expect(result.messageCount).to.be.equal(1);
  });

  test('publish and reject message test', async () => {
    const msg = 'test3_message';
    const msgId = 'test3_1234';
    const queueName = 'test3.queue';
    const sendSMSHandler = jest.fn((m, props, notify) => {
      expect(m).to.be.equal(msg);
      expect(props.properties.messageId).to.be.equal(msgId);
      notify.reject();
    });

    const props = null;

    broker.consume(queueName, sendSMSHandler, props);

    await wait(1000);
    const isPublished = broker.publish(queueName, msg, {
      messageId: msgId,
    });
    expect(isPublished).to.be.true;
    await wait(1000);
    expect(sendSMSHandler.mock.calls.length).to.be.equal(1);

    const result =
        await broker.subscriberChannel.purgeQueue(getDLQName(queueName));
    expect(result.messageCount).to.be.equal(1);
  });

  test('re-establish connection test', async () => {
    const msg = 'test4_message';
    const msgId = 'test4_1234';
    const queueName = 'test4.queue';
    const sendSMSHandler = jest.fn((m, props, notify) => {
      expect(m).to.be.equal(msg);
      expect(props.properties.messageId).to.be.equal(msgId);
      notify.ack();
    });

    const props = {
      messageTtl: 100,
      headers: {},
    };
    props.headers[MQ_MAX_RETRY_COUNT_HEADER] = 4;
    props.headers[MQ_RETRY_DELAY_HEADER] = 500;

    broker.consume(queueName, sendSMSHandler, props);

    await wait(1000);
    broker.close();
    await wait(2000);
    const isPublished = broker.publish(queueName, msg, {
      messageId: msgId,
    });
    expect(isPublished).to.be.true;
    await wait(1000);
    expect(sendSMSHandler.mock.calls.length).to.be.equal(1);
  });

  afterAll(() => {
    broker.close(false);
  });
});
