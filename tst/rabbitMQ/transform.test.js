import {expect} from 'chai';
import {decode, encode} from '../../src/rabbitMQ';

const JSON_TYPE = 'application/json';
const UTF_8 = 'utf8';

describe('Tranform', () => {
  const msg = 'Yada Yada Yada';
  const msgObj = {
    messgae: msg,
  };
  const msgBuffer = Buffer.from(msg, UTF_8);
  const props = {
    name: 'AVATAR',
  };

  test('string encoding test', () => {
    const output = encode(msg, props);
    expect(output.buffer.toString(UTF_8)).to.be.equal(msg);
    expect(output.props).to.be.equal(props);
  });

  test('buffer encoding test', () => {
    const output = encode(msgBuffer, props);
    expect(output.buffer.toString(UTF_8)).to.be.equal(msg);
    expect(output.props).to.be.equal(props);
  });

  test('object encoding test', () => {
    const output = encode(msgObj, props);
    expect(JSON.parse(output.buffer.toString(UTF_8))).to.be.eql(msgObj);
    expect(output.props).to.be.equal(props);
    expect(output.props.contentType).to.be.equal(JSON_TYPE);
  });

  test('object encoding test without props', () => {
    const output = encode(msgObj, null);
    expect(JSON.parse(output.buffer.toString(UTF_8))).to.be.eql(msgObj);
    expect(output.props.contentType).to.be.equal(JSON_TYPE);
  });

  test('string decode test', () => {
    const input = {
      content: msgBuffer,
    };
    const output = decode(input);
    expect(output).to.be.equal(msg);
  });

  test('object decode test', () => {
    const input = {
      content: Buffer.from(JSON.stringify(msgObj), UTF_8),
      properties: {
        contentType: JSON_TYPE,
      },
    };
    const output = decode(input);
    expect(output).to.be.eql(msgObj);
  });
});
