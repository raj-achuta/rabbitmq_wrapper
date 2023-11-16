+ [![cov](https://we-cli.github.io/jayin/badges/coverage.svg)](https://github.com/we-cli/jayin/actions)

# RabbitMQ Wrapper

This is built on top amqplib which helps your team to write the consumer & publisher faster.
This is built thinking in the mind of worker queues pattern.

While creating any queues through the wrapper will automitically create and DLQ & retry.

## How to use?
Add this package under the dependencies.

```
npm install @rachuta/rabbitmq-wrapper --save
```

```js
// src/index.js

import { Broker } from '@rachuta/rabbitmq-wrapper'

const broker = new Broker()
    .setConfig({
        username: 'username',
        password: 'password',
        hostname: 'hostname',
        port: 5671,
        protocol: 'amqps',
        heartbeat: 20
    })
    .setLogger(winston_loger) // optional; console is the default logger.
    .setConnectionRecoveryTimeout(3000) // optional, value is in MS; default value is 10 seconds
    .build()

// Subscriber
broker.consume('test.queue', function(msg, props, notify) {
    if(!inputValidator(msg))
        notify.reject() // Move message to DLQ

    try {
        // place your code here
    } catch (err) {
        notify.nack() // Move message to delay queue and retry for 3 times with 5 mins interval and move DLQ if unable to process the message in all retries.
    }
 
    notify.ack() // message processed and deleted.
})

// publisher
broker.publish('test.queue', 'Hello World!!', {})
```

Consumer and publisher functions can take the message as an object/string/buffer. If you pass an object, the message properties are set to `application/json`, and the message are passed as an object to the consumer.

Publisher can't create queues so, we recommend to deploying consumers before publishers.

### Message retry mechanism

@rachuta/rabbitmq-wrapper enables message retry mechanism by default, and there is no way to disable it. So please set the below headers to configure the retry mechanism.

```js
broker.consume('notification.t.sms', handler , {
    messageTtl: 60000, // message live in queue before move to DLQ; default value is 5 min
    headers: {
        'x-max-retry': 4, // maximum message retries; default value is 3
        'x-delay': 30000 // each retry delay; default value is is 5 min
    }
})
```

P.S: Only nack messages will be retried.

## How to run test locally?

You need [Docker][1] to run RabbitMQ Install.

```bash
# Terminal 1
$ docker run -it --rm --name rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:latest

# Terminal 2(code base)
$ npm run test
```

[1]: https://docs.docker.com/engine/install/
