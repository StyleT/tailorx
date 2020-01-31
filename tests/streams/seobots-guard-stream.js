'use strict';
const assert = require('assert');
const sinon = require('sinon');
const util = require('util');
const setTimeoutPromise = util.promisify(setTimeout);
const EventEmitter = require('events').EventEmitter;

const BotGuardStream = require('../../lib/streams/seobots-guard-stream');

const resStub = {
    statusCode: 0,
    writeHead: () => {}
};
const resStubSpy = sinon.spy(resStub, 'writeHead');

const headersStub = Object.freeze({
    bot: { 'user-agent': 'Googlebot-Image/1.0' },
    notBot: {
        'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.117 Safari/537.36'
    }
});

class Fragment extends EventEmitter {}

describe('SeoBotsGuardStream', () => {
    afterEach(() => {
        resStub.statusCode = 0;
        resStubSpy.resetHistory();
    });

    describe('when processes request from Bot', () => {
        it('prevents data flow until all fragments will respond', done => {
            const fragment1 = new Fragment();
            const fragment2 = new Fragment();
            let bothResponded = false;

            const st = new BotGuardStream(true, headersStub.bot, resStub);
            st.on('data', data => {
                data = Buffer.from(data).toString('utf-8');

                try {
                    assert.equal(data, 'some test data');
                    assert.ok(
                        bothResponded,
                        'Data came after response of both fragments'
                    );
                    assert.equal(resStub.statusCode, 200);
                    assert(resStubSpy.calledOnceWith(200, { a: 'b' }));
                } catch (e) {
                    return done(e);
                }

                done();
            });

            st.write(Buffer.from('some test data'));
            st.statusCode = 200;
            st.writeHead(200, { a: 'b' });

            st.addFragment(fragment1);
            st.addFragment(fragment2);

            setTimeoutPromise(20)
                .then(() => fragment1.emit('response'))
                .then(() => setTimeoutPromise(20))
                .then(() => {
                    assert.equal(resStub.statusCode, 0);
                    assert(resStubSpy.notCalled);
                    fragment2.emit('response');
                    bothResponded = true;
                })
                .then(() => setTimeoutPromise(20))
                .then(() => st.end())
                .catch(e => done(e));
        });

        it('emits "error" event while blocking data flow in case of one of the fragments error', done => {
            const fragment1 = new Fragment();
            const fragment2 = new Fragment();
            const fragment3 = new Fragment();

            const st = new BotGuardStream(true, headersStub.bot, resStub);
            st.addFragment(fragment1);
            st.addFragment(fragment2);
            st.addFragment(fragment3);
            st.on('data', () => done(new Error('Failed to prevent data flow')));
            st.on('error', err => {
                try {
                    assert.equal(resStub.statusCode, 0);
                    assert(resStubSpy.notCalled);
                    assert.equal(
                        err.message,
                        'Fragment error while processing request from SEO/SM bot. See adjacent messages for real cause.'
                    );
                } catch (e) {
                    return done(e);
                }

                done();
            });

            st.write(Buffer.from('some test data'));
            st.statusCode = 200;
            st.writeHead(200, { a: 'b' });

            setTimeoutPromise(20)
                .then(() => fragment1.emit('response'))
                .then(() => setTimeoutPromise(20))
                .then(() => {
                    fragment2.emit('error');
                    fragment3.emit('error');
                    st.write(Buffer.from('some test data'));
                })
                .then(() => setTimeoutPromise(20))
                .then(() => st.end())
                .catch(e => done(e));
        });

        it('does nothing when disabled', done => {
            const st = new BotGuardStream(false, headersStub.bot, resStub);
            st.on('data', data => {
                data = Buffer.from(data).toString('utf-8');

                try {
                    assert.equal(data, 'some test data');
                    assert.equal(resStub.statusCode, 200);
                    assert(resStubSpy.calledOnceWith(200, { a: 'b' }));
                } catch (e) {
                    return done(e);
                }

                done();
            });

            st.statusCode = 200;
            st.writeHead(200, { a: 'b' });
            st.write(Buffer.from('some test data'));
        });
    });
    describe('when processes request NOT from Bot', () => {
        it('does nothing', done => {
            const st = new BotGuardStream(true, headersStub.notBot, resStub);
            st.on('data', data => {
                data = Buffer.from(data).toString('utf-8');

                try {
                    assert.equal(data, 'some test data');
                    assert.equal(resStub.statusCode, 200);
                    assert(resStubSpy.calledOnceWith(200, { a: 'b' }));
                } catch (e) {
                    return done(e);
                }

                done();
            });

            st.statusCode = 200;
            st.writeHead(200, { a: 'b' });
            st.write(Buffer.from('some test data'));
        });
    });
});
