'use strict';

const JSON_TYPE = 'application/json';
const UTF_8 = 'utf8';

function encode(body, props) {
  const message = {
    props: props,
    buffer: {},
  };

  if (typeof body === 'string') {
    message.buffer = Buffer.from(body, UTF_8);
  } else if (body instanceof Buffer) {
    message.buffer = body;
  } else {
    if (!message.props) message.props = {};
    message.props.contentType = JSON_TYPE;
    message.buffer = Buffer.from(JSON.stringify(body), UTF_8);
  }

  return message;
}

function decode(message) {
  const props = message.properties || {};
  const messageStr = message.content.toString(UTF_8);
  return (props.contentType === JSON_TYPE) ?
    JSON.parse(messageStr) : messageStr;
}

export {
  encode,
  decode,
};
