'use strict';
const assert = require('assert');
const http = require('http');
const nock = require('nock');
const sinon = require('sinon');
const zlib = require('zlib');
const { TEMPLATE_NOT_FOUND } = require('../lib/fetch-template');
const Tailor = require('../index');
const processTemplate = require('../lib/process-template');
const { Tags, MockTracer } = require('opentracing');

//Custom mock tracer for Unit tests
class CustomTracer extends MockTracer {
    inject() {}
    extract() {}
}

const stripComments = v => v.replace(/<!--.+?-->/g, '');

describe('Tailor', () => {
    let server;
    const tracer = new CustomTracer();
    const mockTemplate = sinon.stub();
    const mockChildTemplate = sinon.stub();
    const mockContext = sinon.stub();
    const cacheTemplate = sinon.spy();

    function getResponse(url) {
        return new Promise(resolve => {
            http.get(url, response => {
                let chunks = [];
                response.on('data', chunk => chunks.push(chunk));
                response.on('end', () => {
                    response.body = Buffer.concat(chunks).toString('utf8');
                    resolve(response);
                });
            });
        });
    }

    const createTailorInstance = ({
        maxAssetLinks = 1,
        getAssetsToPreload = () => ({ scriptRefs: ['https://loader'] }),
        fragmentHooks = {},
        shouldSetPrimaryFragmentAssetsToPreload = true
    }) => {
        const options = {
            getAssetsToPreload,
            maxAssetLinks,
            fragmentHooks,
            fetchContext: mockContext,
            fetchTemplate: (request, parseTemplate) => {
                const template = mockTemplate(request);
                const childTemplate = mockChildTemplate(request);
                if (template) {
                    if (template === '404') {
                        const error = new Error();
                        error.code = TEMPLATE_NOT_FOUND;
                        error.presentable = 'template not found';
                        return Promise.reject(error);
                    }
                    return parseTemplate(template, childTemplate).then(
                        parsedTemplate => {
                            cacheTemplate(template);
                            return parsedTemplate;
                        }
                    );
                } else {
                    const error = new Error();
                    error.presentable = 'error template';
                    return Promise.reject(error);
                }
            },
            handledTags: ['delayed-fragment'],
            handleTag: (request, tag, options, context) => {
                if (tag.name === 'delayed-fragment') {
                    const st = processTemplate(request, options, context);
                    setTimeout(() => {
                        st.end({
                            name: 'fragment',
                            attributes: {
                                async: true,
                                src: 'https://fragment/1'
                            }
                        });
                    }, 10);
                    return st;
                }

                return '';
            },
            filterResponseHeaders: (attributes, headers) => headers,
            tracer,
            shouldSetPrimaryFragmentAssetsToPreload
        };

        return new Tailor(options);
    };

    beforeEach(done => {
        const tailor = createTailorInstance({});
        mockContext.returns(Promise.resolve({}));
        server = http.createServer(tailor.requestHandler);
        server.listen(8080, 'localhost', done);
    });

    afterEach(done => {
        mockContext.reset();
        mockTemplate.reset();
        mockChildTemplate.reset();
        cacheTemplate.resetHistory();
        server.close(done);
        nock.cleanAll();
    });

    describe('Basic Features::Tailor', () => {
        it('"should return 500 with presentable error if the layout wasn\'t found"', done => {
            mockTemplate.returns(false);
            getResponse('http://localhost:8080/missing-template')
                .then(response => {
                    assert.equal(response.statusCode, 500);
                    assert.equal(response.body, 'error template');
                })
                .then(done, done);
        });

        it('"should return 500, by default, if template was not found', done => {
            mockTemplate.returns('404');
            getResponse('http://localhost:8080/404-template')
                .then(response => {
                    assert.equal(response.statusCode, 500);
                    assert.equal(response.body, 'template not found');
                })
                .then(done, done);
        });

        it('should stream content from http and https fragments', done => {
            nock('https://fragment')
                .get('/1')
                .reply(200, 'hello');

            nock('http://fragment:9000')
                .get('/2')
                .reply(200, 'world');

            mockTemplate.returns(
                '<fragment id="f-1" src="https://fragment/1"></fragment>' +
                    '<fragment id="f-2" src="http://fragment:9000/2"></fragment>'
            );

            getResponse('http://localhost:8080/test')
                .then(response => {
                    assert.equal(response.statusCode, 200);
                    assert.equal(
                        stripComments(response.body),
                        '<html>' +
                            '<head></head>' +
                            '<body>' +
                            'hello' +
                            'world' +
                            '</body>' +
                            '</html>'
                    );
                })
                .then(done, done);
        });

        // TODO: add async fragments support
        it('should support async fragments', done => {
            nock('https://fragment')
                .get('/1')
                .reply(200, 'hello');

            mockTemplate.returns(
                '<fragment src="https://fragment/1" async></fragment>'
            );

            getResponse('http://localhost:8080/test')
                .then(response => {
                    assert.equal(
                        response.body,
                        '<html>' +
                            '<head></head>' +
                            '<body>' +
                            '<!-- Async fragments are not fully implemented yet -->' +
                            '<!-- Fragment #0 START -->' +
                            'hello' +
                            '<!-- Fragment #0 END -->' +
                            '</body>' +
                            '</html>'
                    );
                })
                .then(done, done);
        });

        it('should support script based fragments for inserting in head', done => {
            nock('https://fragment')
                .get('/yes')
                .reply(200, 'yes');

            mockTemplate.returns(
                '<script type="fragment" src="https://fragment/yes"></script>'
            );

            getResponse('http://localhost:8080/test')
                .then(response => {
                    assert.equal(
                        stripComments(response.body),
                        '<html>' +
                            '<head>' +
                            'yes' +
                            '</head>' +
                            '<body></body>' +
                            '</html>'
                    );
                })
                .then(done, done);
        });

        it('should support fragments with "forward-querystring" attribute', done => {
            nock('https://fragment')
                .get('/1?a=3&b=2')
                .reply(200, 'hello');

            mockTemplate.returns(
                '<fragment src="https://fragment/1?a=3" forward-querystring></fragment>'
            );

            getResponse('http://localhost:8080/test?a=1&b=2')
                .then(response => {
                    assert.equal(
                        stripComments(response.body),
                        '<html>' +
                            '<head></head>' +
                            '<body>' +
                            'hello' +
                            '</body>' +
                            '</html>'
                    );
                })
                .then(done, done);
        });

        it('should render only primary fragments if response code is neither 2xx nor 5xx', done => {
            nock('https://fragment')
                .get('/1')
                .reply(300, 'hello 1')
                .get('/2')
                .reply(401, 'hello 2')
                .get('/3')
                .reply(300, 'hello 3')
                .get('/4')
                .reply(401, 'hello 4');

            mockTemplate.returns(
                '<fragment src="https://fragment/1" primary></fragment>' +
                    '<fragment src="https://fragment/2" primary></fragment>' +
                    '<fragment src="https://fragment/3"></fragment>' +
                    '<fragment src="https://fragment/4"></fragment>'
            );

            getResponse('http://localhost:8080/test')
                .then(response => {
                    assert.equal(
                        stripComments(response.body),
                        '<html>' +
                            '<head></head>' +
                            '<body>' +
                            'hello 1hello 2' +
                            '</body>' +
                            '</html>'
                    );
                })
                .then(done, done);
        });
    });

    describe('Headers::Tailor', () => {
        it('should return response code and location header of the 1st primary fragment', done => {
            nock('https://fragment')
                .get('/1')
                .reply(200, 'hello')
                .get('/2')
                .reply(300, 'world', { Location: 'https://redirect' })
                .get('/3')
                .reply(500, '!');

            mockTemplate.returns(
                '<fragment src="https://fragment/1"></fragment>' +
                    '<fragment src="https://fragment/2" primary></fragment>' +
                    '<fragment src="https://fragment/3" primary></fragment>'
            );

            getResponse('http://localhost:8080/test')
                .then(response => {
                    assert.equal(response.statusCode, 300);
                    assert.equal(response.headers.location, 'https://redirect');
                })
                .then(done, done);
        });

        it('should return headers from primary fragment', done => {
            const cookie = 'zalando.guid=6cc4da81; path=/; httponly';

            nock('https://fragment')
                .get('/1')
                .reply(200, 'hello', { 'Set-Cookie': 'wrong' })
                .get('/2')
                .reply(200, 'world', {
                    'Set-Cookie': cookie
                })
                .get('/3')
                .reply(201);

            mockTemplate.returns(
                '<fragment src="https://fragment/1"></fragment>' +
                    '<fragment src="https://fragment/2" primary></fragment>' +
                    '<fragment src="https://fragment/3"></fragment>'
            );

            getResponse('http://localhost:8080/test')
                .then(response => {
                    assert.equal(response.statusCode, 200);
                    assert.deepEqual(response.headers['set-cookie'], [cookie]);
                })
                .then(done, done);
        });

        it('should return headers from primary & "return-headers" fragments', done => {
            const cookiePrimary = 'zalando.guid=6cc4da81; path=/; httponly';
            const cookie = ['zalando.guid=wrong', 'aaa=bbb', 'bbb=ccc'];
            const cookieExpected = [
                'zalando.guid=6cc4da81; path=/; httponly',
                'aaa=bbb',
                'bbb=ccc'
            ];

            nock('https://fragment')
                .get('/1')
                .delay(20)
                .reply(200, 'hello', { 'Set-Cookie': cookie })
                .get('/2')
                .reply(200, 'world', {
                    'Set-Cookie': cookiePrimary
                })
                .get('/3')
                .reply(201);

            mockTemplate.returns(
                '<fragment return-headers src="https://fragment/1"></fragment>' +
                    '<fragment src="https://fragment/2" primary></fragment>' +
                    '<fragment src="https://fragment/3"></fragment>'
            );

            getResponse('http://localhost:8080/test')
                .then(res => {
                    assert.equal(res.statusCode, 200);
                    assert.deepEqual(res.headers['set-cookie'], cookieExpected);
                })
                .then(done, done);
        });

        it('should return headers from "return-headers" fragments', done => {
            const cookie = [
                'zalando.guid=6cc4da81; path=/; httponly',
                'aaa=bbb',
                'bbb=ccc'
            ];

            nock('https://fragment')
                .get('/1')
                .reply(200, 'hello', { 'Set-Cookie': cookie })
                .get('/2')
                .reply(201);

            mockTemplate.returns(
                '<fragment return-headers src="https://fragment/1"></fragment>' +
                    '<fragment src="https://fragment/2"></fragment>'
            );

            getResponse('http://localhost:8080/test')
                .then(response => {
                    assert.equal(response.statusCode, 200);
                    assert.deepEqual(response.headers['set-cookie'], cookie);
                })
                .then(done, done);
        });

        it('should forward headers to fragment', done => {
            const headers = {
                'X-Zalando-Custom': 'test',
                Referer: 'https://google.com',
                'Accept-Language': 'en-gb',
                'User-Agent': 'MSIE6',
                'X-Wrong-Header': 'should not be forwarded',
                Cookie: 'value'
            };

            const expectedHeaders = {
                'X-Zalando-Custom': 'test',
                Referer: 'https://google.com',
                'Accept-Language': 'en-gb',
                'User-Agent': 'MSIE6'
            };

            nock('https://fragment', {
                reqheaders: expectedHeaders,
                badheaders: ['X-Wrong-Header', 'Cookie']
            })
                .get('/')
                .reply(200);

            mockTemplate.returns(
                '<fragment src="https://fragment/"></fragment>'
            );

            http.get(
                {
                    hostname: 'localhost',
                    path: '/test',
                    port: 8080,
                    headers: headers
                },
                response => {
                    response.resume();
                    done();
                }
            );
        });

        it('should disable browser cache', done => {
            nock('https://fragment')
                .get('/1')
                .reply(200, 'hello');

            mockTemplate.returns(
                '<fragment src="https://fragment/1"></fragment>'
            );

            getResponse('http://localhost:8080/test')
                .then(response => {
                    const headers = response.headers;
                    assert.equal(
                        'no-cache, no-store, must-revalidate',
                        headers['cache-control']
                    );
                    assert.equal('no-cache', headers['pragma']);
                })
                .then(done, done);
        });

        describe('Preloading', () => {
            after(() => {
                mockTemplate.reset();
            });
            it('should preload external module loader if fragment is present', done => {
                nock('https://fragment')
                    .get('/1')
                    .reply(200, 'non-primary', {
                        Link:
                            '<http://non-primary>; rel="stylesheet",<http://non-primary>; rel="fragment-script"'
                    });

                mockTemplate.returns(
                    '<fragment src="https://fragment/1"></fragment>'
                );

                getResponse('http://localhost:8080/test')
                    .then(response => {
                        assert.equal(
                            response.headers.link,
                            '<https://loader>; rel="preload"; as="script"; nopush; crossorigin'
                        );
                    })
                    .then(done, done);
            });

            ['Link', 'x-amz-meta-link'].forEach(linkHeader => {
                it(`should preload only primary fragment assets for header ${linkHeader}`, done => {
                    nock('https://fragment')
                        .get('/1')
                        .reply(200, 'non-primary', {
                            [linkHeader]:
                                '<http://non-primary>; rel="stylesheet",<http://non-primary>; rel="fragment-script"'
                        })
                        .get('/2')
                        .reply(200, 'primary', {
                            [linkHeader]:
                                '<http://primary>; rel="stylesheet",<http://primary>; rel="fragment-script"'
                        });

                    mockTemplate.returns(
                        '<fragment src="https://fragment/1"></fragment>' +
                            '<fragment primary src="https://fragment/2"></fragment>'
                    );

                    getResponse('http://localhost:8080/test')
                        .then(response => {
                            assert.equal(
                                response.headers.link,
                                '<https://loader>; rel="preload"; as="script"; nopush; crossorigin,<http://primary>; rel="preload"; as="style"; nopush;,<http://primary>; rel="preload"; as="script"; nopush; crossorigin'
                            );
                        })
                        .then(done, done);
                });
            });

            describe('when options.shouldSetPrimaryFragmentAssetsToPreload is false', () => {
                let server;

                beforeEach(done => {
                    const tailor = createTailorInstance({
                        shouldSetPrimaryFragmentAssetsToPreload: false
                    });
                    server = http.createServer(tailor.requestHandler);
                    server.listen(8083, 'localhost', done);
                });

                afterEach(done => {
                    server.close(done);
                });

                it('should not preload primary fragment assets for header Link', done => {
                    nock('https://fragment')
                        .get('/2')
                        .reply(200, 'primary', {
                            Link:
                                '<http://primary>; rel="stylesheet",<http://primary>; rel="fragment-script"'
                        });

                    mockTemplate.returns(
                        '<fragment primary src="https://fragment/2"></fragment>'
                    );

                    getResponse('http://localhost:8083/test')
                        .then(response => {
                            assert.equal(
                                response.headers.link,
                                '<https://loader>; rel="preload"; as="script"; nopush; crossorigin'
                            );
                        })
                        .then(done, done);
                });
            });

            it('should not send crossorigin in Link headers for same origin scripts', done => {
                nock('http://fragment')
                    .get('/')
                    .reply(200, 'primary', {
                        Link:
                            '<http://localhost:8080>; rel="stylesheet",<http://localhost:8080>; rel="fragment-script"'
                    });

                mockTemplate.returns(
                    '<fragment primary src="http://fragment/"></fragment>'
                );

                getResponse('http://localhost:8080/test')
                    .then(response => {
                        assert.equal(
                            response.headers.link,
                            '<https://loader>; rel="preload"; as="script"; nopush; crossorigin,<http://localhost:8080>; rel="preload"; as="style"; nopush;,<http://localhost:8080>; rel="preload"; as="script"; nopush;'
                        );
                    })
                    .then(done, done);
            });

            describe('"getAssetsToPreload" TailorX option should correctly work', () => {
                let withFile;
                beforeEach(done => {
                    const tailor3 = createTailorInstance({
                        getAssetsToPreload: request => {
                            if (
                                request.url == '/should-return-specific-assets'
                            ) {
                                return {
                                    scriptRefs: [
                                        'https://loader/specific-script.js',
                                        '/specific-script.js'
                                    ],
                                    styleRefs: [
                                        'https://loader/specific-style.css',
                                        '/specific-style.css'
                                    ]
                                };
                            }

                            return {
                                scriptRefs: ['https://loader/a.js', '/b.js'],
                                styleRefs: ['https://loader/a.css', '/b.css']
                            };
                        }
                    });
                    withFile = http.createServer(tailor3.requestHandler);
                    withFile.listen(8082, 'localhost', done);
                });

                afterEach(done => {
                    mockTemplate.reset();
                    withFile.close(done);
                });

                it('without primary fragment', done => {
                    nock('https://fragment')
                        .get('/1')
                        .reply(200, 'non-primary', {
                            Link:
                                '<http://non-primary>; rel="stylesheet",<http://non-primary>; rel="fragment-script"'
                        });

                    mockTemplate.returns(
                        '<fragment src="https://fragment/1"></fragment>'
                    );

                    getResponse('http://localhost:8082/test')
                        .then(response => {
                            assert.equal(
                                response.headers.link,
                                '<https://loader/a.css>; rel="preload"; as="style"; nopush;,' +
                                    '</b.css>; rel="preload"; as="style"; nopush;,' +
                                    '<https://loader/a.js>; rel="preload"; as="script"; nopush; crossorigin,' +
                                    '</b.js>; rel="preload"; as="script"; nopush;'
                            );
                        })
                        .then(done, done);
                });

                it('with primary fragment', done => {
                    nock('https://fragment')
                        .get('/1')
                        .reply(200, 'non-primary', {
                            Link:
                                '<http://primary>; rel="stylesheet",<http://primary>; rel="fragment-script"'
                        });

                    mockTemplate.returns(
                        '<fragment primary src="https://fragment/1"></fragment>'
                    );

                    getResponse('http://localhost:8082/test')
                        .then(response => {
                            assert.equal(
                                response.headers.link,
                                '<https://loader/a.css>; rel="preload"; as="style"; nopush;,' +
                                    '</b.css>; rel="preload"; as="style"; nopush;,' +
                                    '<https://loader/a.js>; rel="preload"; as="script"; nopush; crossorigin,' +
                                    '</b.js>; rel="preload"; as="script"; nopush;,' +
                                    '<http://primary>; rel="preload"; as="style"; nopush;,' +
                                    '<http://primary>; rel="preload"; as="script"; nopush; crossorigin'
                            );
                        })
                        .then(done, done);
                });

                it('should return assets depend to request', done => {
                    nock('https://fragment')
                        .get('/1')
                        .reply(200, 'non-primary', {
                            Link:
                                '<http://non-primary>; rel="stylesheet",<http://non-primary>; rel="fragment-script"'
                        });

                    mockTemplate.returns(
                        '<fragment src="https://fragment/1"></fragment>'
                    );

                    getResponse(
                        'http://localhost:8082/should-return-specific-assets'
                    )
                        .then(response => {
                            assert.equal(
                                response.headers.link,
                                '<https://loader/specific-style.css>; rel="preload"; as="style"; nopush;,' +
                                    '</specific-style.css>; rel="preload"; as="style"; nopush;,' +
                                    '<https://loader/specific-script.js>; rel="preload"; as="script"; nopush; crossorigin,' +
                                    '</specific-script.js>; rel="preload"; as="script"; nopush;'
                            );
                        })
                        .then(done, done);
                });
            });
        });
    });

    describe('Timeout::Tailor ', () => {
        it('should set timeout for a fragment request', done => {
            nock('https://fragment')
                .get('/1')
                .socketDelay(101)
                .reply(200, 'hello')
                .get('/2')
                .socketDelay(3001)
                .reply(200, 'world');

            mockTemplate.returns(
                '<fragment src="https://fragment/1" timeout="100"></fragment>' +
                    '<fragment src="https://fragment/2"></fragment>'
            );

            getResponse('http://localhost:8080/test')
                .then(response => {
                    assert.equal(
                        response.body,
                        '<html><head></head><body></body></html>'
                    );
                })
                .then(done, done);
        });

        it('should return 500 in case of primary timeout', done => {
            nock('https://fragment')
                .get('/1')
                .socketDelay(101)
                .reply(200, 'hello');

            mockTemplate.returns(
                '<fragment src="https://fragment/1" primary timeout="100"></fragment>'
            );

            getResponse('http://localhost:8080/test')
                .then(response => {
                    assert.equal(response.statusCode, 500);
                })
                .then(done, done);
        });
    });

    describe('Link::Tailor: ', () => {
        it('should insert link to css from fragment link header', done => {
            nock('https://fragment')
                .get('/1')
                .reply(200, 'hello', {
                    Link:
                        '<http://link>; rel="stylesheet",<http://link2>; rel="fragment-script"'
                });

            mockTemplate.returns(
                '<fragment src="https://fragment/1"></fragment>'
            );

            getResponse('http://localhost:8080/test')
                .then(response => {
                    assert.equal(
                        stripComments(response.body),
                        '<html>' +
                            '<head></head>' +
                            '<body>' +
                            '<link rel="stylesheet" href="http://link">' +
                            'hello' +
                            '<script type="text/javascript" src="http://link2"></script>' +
                            '</body>' +
                            '</html>'
                    );
                })
                .then(done, done);
        });

        it('should insert link to css from fragment link header, if fragment has "id" specified', done => {
            nock('https://fragment')
                .get('/1')
                .reply(200, 'hello', {
                    Link:
                        '<http://link>; rel="stylesheet",<http://link2>; rel="fragment-script"'
                });

            mockTemplate.returns(
                '<fragment id="tstid" src="https://fragment/1"></fragment>'
            );

            getResponse('http://localhost:8080/test')
                .then(response => {
                    assert.equal(
                        stripComments(response.body),
                        '<html>' +
                            '<head></head>' +
                            '<body>' +
                            '<link rel="stylesheet" href="http://link" data-fragment-id="tstid">' +
                            'hello' +
                            '<script type="text/javascript" src="http://link2" data-fragment-id="tstid"></script>' +
                            '</body>' +
                            '</html>'
                    );
                })
                .then(done, done);
        });

        // TODO: add async fragments support
        it('should use loadCSS for async fragments', done => {
            nock('https://fragment')
                .get('/1')
                .reply(200, 'hello', {
                    Link:
                        '<http://link>; rel="stylesheet",<http://link2>; rel="fragment-script"'
                });

            mockTemplate.returns(
                '<fragment async src="https://fragment/1"></fragment>'
            );

            getResponse('http://localhost:8080/test')
                .then(response => {
                    assert.equal(
                        response.body,
                        '<html><head></head><body>' +
                            '<!-- Async fragments are not fully implemented yet -->' +
                            '<!-- Fragment #0 START -->' +
                            '<!-- Async fragments are not fully implemented yet: http://link -->' +
                            'hello' +
                            '<script type="text/javascript" src="http://link2"></script>' +
                            '<!-- Fragment #0 END -->' +
                            '</body></html>'
                    );
                })
                .then(done, done);
        });

        it('should insert link to css and require js  from fragment x-amz-meta-link header', done => {
            nock('https://fragment')
                .get('/1')
                .reply(200, 'hello', {
                    'X-AMZ-META-LINK':
                        '<http://link>; rel="stylesheet",<http://link2>; rel="fragment-script"'
                });

            mockTemplate.returns(
                '<fragment src="https://fragment/1"></fragment>'
            );

            getResponse('http://localhost:8080/test')
                .then(response => {
                    assert.equal(
                        stripComments(response.body),
                        '<html>' +
                            '<head></head>' +
                            '<body>' +
                            '<link rel="stylesheet" href="http://link">' +
                            'hello' +
                            '<script type="text/javascript" src="http://link2"></script>' +
                            '</body>' +
                            '</html>'
                    );
                })
                .then(done, done);
        });
    });

    describe('Attributes and Context::Tailor', () => {
        it('should get attributes from context and not mutate the template with the context', done => {
            nock('https://fragment')
                .get('/yes')
                .reply(200, 'yes')
                .get('/no')
                .reply(200, 'no');

            mockTemplate.returns(
                '<fragment primary id="f-1" src="https://fragment/no"></frgament>'
            );

            const contextObj = {
                'f-1': {
                    src: 'https://fragment/yes',
                    primary: false
                }
            };
            mockContext.returns(Promise.resolve(contextObj));

            getResponse('http://localhost:8080/test')
                .then(response => {
                    assert.equal(response.statusCode, 200);
                    assert.equal(
                        stripComments(response.body),
                        '<html>' +
                            '<head></head>' +
                            '<body>' +
                            'yes' +
                            '</body>' +
                            '</html>'
                    );

                    // Second request
                    mockContext.returns(Promise.resolve({}));
                    mockTemplate.returns(cacheTemplate.args[0][0]);

                    getResponse('http://localhost:8080/test')
                        .then(response => {
                            assert.equal(response.statusCode, 200);
                            assert.equal(
                                stripComments(response.body),
                                '<html>' +
                                    '<head></head>' +
                                    '<body>' +
                                    'no' +
                                    '</body>' +
                                    '</html>'
                            );
                        })
                        .then(done, done);
                })
                .catch(done);
        });
    });

    describe('Custom async fragments', () => {
        //TODO: add async fragments support
        it('should add async fragments from handleTag', done => {
            nock('https://fragment')
                .get('/1')
                .reply(200, 'hello');

            mockTemplate.returns('<delayed-fragment></delayed-fragment>');
            mockChildTemplate.returns('');

            getResponse('http://localhost:8080/test')
                .then(response => {
                    assert.equal(
                        response.body,
                        '<html><head></head><body>' +
                            '<!-- Async fragments are not fully implemented yet -->' +
                            '<!-- Fragment #0 START -->' +
                            'hello' +
                            '<!-- Fragment #0 END -->' +
                            '</body></html>'
                    );
                })
                .then(done, done);
        });
    });

    describe('Slots::Tailor ', () => {
        it('should support base templates using slots', done => {
            mockTemplate.returns(
                '<head>' +
                    '<script type="slot" name="head"></script>' +
                    '</head>'
            );

            mockChildTemplate.returns('<meta slot="head" charset="utf-8">');

            getResponse('http://localhost:8080/test')
                .then(response => {
                    assert.equal(
                        response.body,
                        '<html>' +
                            '<head>' +
                            '<meta charset="utf-8">' +
                            '</head>' +
                            '<body></body>' +
                            '</html>'
                    );
                })
                .then(done, done);
        });

        it('should support custom slots for shuffling the nodes', done => {
            mockTemplate.returns(
                '<head>' +
                    '<script type="slot" name="head"></script>' +
                    '</head>' +
                    '<body>' +
                    '<slot name="custom"></slot>' +
                    '</body>'
            );

            mockChildTemplate.returns(
                '<script slot="custom" src=""></script>' +
                    '<meta slot="head" charset="utf-8">' +
                    '<h2>Last</h2>'
            );

            getResponse('http://localhost:8080/test')
                .then(response => {
                    assert.equal(
                        response.body,
                        '<html>' +
                            '<head>' +
                            '<meta charset="utf-8">' +
                            '</head>' +
                            '<body>' +
                            '<script src=""></script>' +
                            '<h2>Last</h2>' +
                            '</body>' +
                            '</html>'
                    );
                })
                .then(done, done);
        });

        it('should insert default slots if unnamed slot is present in parent template', done => {
            mockTemplate.returns(
                '<head>' +
                    '</head>' +
                    '<body>' +
                    '<slot></slot>' +
                    '<h2>blah</h2>' +
                    '</body>'
            );

            mockChildTemplate.returns('<h1>hello</h1>');

            getResponse('http://localhost:8080/test')
                .then(response => {
                    assert.equal(
                        response.body,
                        '<html>' +
                            '<head></head>' +
                            '<body>' +
                            '<h1>hello</h1>' +
                            '<h2>blah</h2>' +
                            '</body>' +
                            '</html>'
                    );
                })
                .then(done, done);
        });

        it('should insert default slots if a slot named default is present in parent template', done => {
            mockTemplate.returns(
                '<head>' +
                    '</head>' +
                    '<body>' +
                    '<slot name="default"></slot>' +
                    '<h2>blah</h2>' +
                    '</body>'
            );

            mockChildTemplate.returns('<h1>hello from default named slot</h1>');

            getResponse('http://localhost:8080/test')
                .then(response => {
                    assert.equal(
                        response.body,
                        '<html>' +
                            '<head></head>' +
                            '<body>' +
                            '<h1>hello from default named slot</h1>' +
                            '<h2>blah</h2>' +
                            '</body>' +
                            '</html>'
                    );
                })
                .then(done, done);
        });

        it('should warn if there are duplicate unnamed slots', done => {
            sinon.stub(console, 'warn');
            mockTemplate.returns('<slot></slot><slot></slot>');

            http.get('http://localhost:8080/test', () => {
                assert.equal(console.warn.callCount, 1);
                console.warn.restore();
                done();
            });
        });

        it('should use the fallback slot nodes if present in the template', done => {
            mockTemplate.returns(
                '<slot name="custom">' + '<h2>hello</h2>' + '</slot>'
            );

            mockChildTemplate.returns('');

            getResponse('http://localhost:8080/test')
                .then(response => {
                    assert.equal(
                        response.body,
                        '<html>' +
                            '<head>' +
                            '</head>' +
                            '<body>' +
                            '<h2>hello</h2>' +
                            '</body>' +
                            '</html>'
                    );
                })
                .then(done, done);
        });

        it('should override the fallback slot nodes with slotted nodes from child template', done => {
            mockTemplate.returns(
                '<slot name="custom">' + '<h2>hello</h2>' + '</slot>'
            );

            mockChildTemplate.returns('<h2 slot="custom">child</h1>');

            getResponse('http://localhost:8080/test')
                .then(response => {
                    assert.equal(
                        response.body,
                        '<html>' +
                            '<head>' +
                            '</head>' +
                            '<body>' +
                            '<h2>child</h2>' +
                            '</body>' +
                            '</html>'
                    );
                })
                .then(done, done);
        });
    });

    describe('Nested Fragments::Tailor ', () => {
        it('should include the child templates after the lastchild of body', done => {
            mockTemplate.returns('<body><h1></h1></body>');

            mockChildTemplate.returns('<div>' + '<h2></h2>' + '</div>');

            getResponse('http://localhost:8080/test')
                .then(response => {
                    assert.equal(
                        response.body,
                        '<html>' +
                            '<head></head>' +
                            '<body>' +
                            '<h1></h1>' +
                            '<div><h2></h2></div>' +
                            '</body>' +
                            '</html>'
                    );
                })
                .then(done, done);
        });

        it('should flatten nested fragments', done => {
            nock('https://fragment')
                .get('/1')
                .reply(200, 'hello')
                .get('/2')
                .reply(200, 'world');

            mockTemplate.returns(
                '<fragment src="https://fragment/1">' +
                    '<fragment src="https://fragment/2">' +
                    '</fragmemt>' +
                    '</fragment>'
            );
            mockChildTemplate.returns('');

            getResponse('http://localhost:8080/test')
                .then(response => {
                    assert.equal(
                        stripComments(response.body),
                        '<html>' +
                            '<head></head>' +
                            '<body>' +
                            'hello' +
                            'world' +
                            '</body>' +
                            '</html>'
                    );
                })
                .then(done, done);
        });

        it('should return 500 even if primary fragment is nested and timed out', done => {
            nock('https://fragment')
                .get('/1')
                .reply(200, 'hello')
                .get('/2')
                .socketDelay(101)
                .reply(200, 'world');

            mockTemplate.returns(
                '<fragment src="https://fragment/1">' +
                    '<fragment primary timeout="100" src="https://fragment/2">' +
                    '</fragmemt>' +
                    '</fragment>'
            );

            http.get('http://localhost:8080/test', response => {
                assert.equal(response.statusCode, 500);
                done();
            });
        });
    });

    describe('Zip::Tailor ', () => {
        it('should unzip the fragment response if it is compressed', done => {
            nock('https://fragment')
                .get('/1')
                .reply(200, () => 'hello')
                .get('/2')
                .reply(
                    200,
                    () => {
                        return zlib.gzipSync('GZIPPED');
                    },
                    {
                        'content-encoding': 'gzip'
                    }
                );

            mockTemplate.returns(
                '<fragment src="https://fragment/1"></fragment>' +
                    '<fragment src="https://fragment/2"></fragment>'
            );

            getResponse('http://localhost:8080/test')
                .then(response => {
                    assert.equal(
                        stripComments(response.body),
                        '<html>' +
                            '<head></head>' +
                            '<body>' +
                            'hello' +
                            'GZIPPED' +
                            '</body>' +
                            '</html>'
                    );
                })
                .then(done, done);
        });

        it('should close the streams properly during unzping error', done => {
            nock('https://fragment')
                .defaultReplyHeaders({
                    'content-encoding': 'gzip'
                })
                .get('/2')
                .reply(200, () => {
                    return new Error('GZIP Error');
                });

            mockTemplate.returns(
                '<fragment src="https://fragment/2"></fragment>'
            );

            getResponse('http://localhost:8080/test')
                .then(response => {
                    assert.equal(
                        response.body,
                        '<html>' +
                            '<head></head>' +
                            '<body>' +
                            '<!-- Fragment #0 START -->' +
                            '<!-- Fragment #0 END -->' +
                            '</body>' +
                            '</html>'
                    );
                })
                .then(done, done);
        });
    });

    describe('without option `maxAssetLinks` provided', () => {
        it('should handle the first fragment-script Header Link only', done => {
            nock('https://fragment')
                .get('/1')
                .reply(200, 'hello maxAssetLinks default', {
                    Link:
                        '<http://link1>; rel="fragment-script", <http://link2>; rel="fragment-script", <http://link3>; rel="fragment-script"'
                });

            mockTemplate.returns(
                '<fragment src="https://fragment/1"></fragment>'
            );

            getResponse('http://localhost:8080/test')
                .then(response => {
                    assert.equal(
                        stripComments(response.body),
                        '<html><head></head><body>' +
                            'hello maxAssetLinks default' +
                            '<script type="text/javascript" src="http://link1"></script>' +
                            '</body></html>'
                    );
                })
                .then(done, done);
        });

        it('should handle the first stylesheet Header Link only', done => {
            nock('https://fragment')
                .get('/1')
                .reply(200, 'hello multiple styles with default config', {
                    Link:
                        '<http://css1>; rel="stylesheet",<http://css2>; rel="stylesheet",<http://css3>; rel="stylesheet"'
                });
            mockTemplate.returns(
                '<fragment src="https://fragment/1"></fragment>'
            );

            getResponse('http://localhost:8080/test')
                .then(response => {
                    assert.equal(
                        stripComments(response.body),
                        '<html>' +
                            '<head></head>' +
                            '<body>' +
                            '<link rel="stylesheet" href="http://css1">' +
                            'hello multiple styles with default config' +
                            '</body>' +
                            '</html>'
                    );
                })
                .then(done, done);
        });
    });

    describe('with `maxAssetLinks` set to `3`', () => {
        let serverCustomOptions;
        beforeEach(done => {
            const tailor2 = createTailorInstance({
                maxAssetLinks: 3,
                pipeDefinition: () => Buffer.from('')
            });
            serverCustomOptions = http.createServer(tailor2.requestHandler);
            serverCustomOptions.listen(8081, 'localhost', done);
        });

        afterEach(done => {
            mockTemplate.reset();
            serverCustomOptions.close(done);
        });

        it('should handle only the first 3 fragment-script Link-rels', done => {
            nock('https://fragment')
                .get('/1')
                .reply(200, 'hello multiple', {
                    Link:
                        '<http://link1>; rel="fragment-script", <http://link2>; rel="fragment-script", <http://link3>; rel="fragment-script",' +
                        '<http://link4>; rel="fragment-script", <http://link5>; rel="fragment-script", <http://link6>; rel="fragment-script"'
                });

            mockTemplate.returns(
                '<fragment src="https://fragment/1"></fragment>'
            );

            getResponse('http://localhost:8081/test')
                .then(response => {
                    assert.equal(
                        stripComments(response.body),
                        '<html><head></head><body>' +
                            'hello multiple' +
                            '<script type="text/javascript" src="http://link3"></script>' +
                            '<script type="text/javascript" src="http://link2"></script>' +
                            '<script type="text/javascript" src="http://link1"></script>' +
                            '</body></html>'
                    );
                })
                .then(done, done);
        });

        //TODO: add async fragments support
        it('should assign correct IDs to sync and async fragments', done => {
            nock('https://fragment')
                .get('/1')
                .reply(200, 'hello many', {
                    Link:
                        '<http://link-a1>; rel="fragment-script", <http://link-a2>; rel="fragment-script", <http://link-a3>; rel="fragment-script",' +
                        '<http://link-a4>; rel="fragment-script"'
                })
                .get('/2')
                .reply(200, 'hello single', {
                    Link: '<http://link-b1>; rel="fragment-script"'
                })
                .get('/3')
                .reply(200, 'hello exactly three async', {
                    Link:
                        '<http://link-c1>; rel="fragment-script", <http://link-c2>; rel="fragment-script", <http://link-c3>; rel="fragment-script",'
                })
                .get('/4')
                .reply(200, 'hello exactly three', {
                    Link:
                        '<http://link-d1>; rel="fragment-script", <http://link-d2>; rel="fragment-script", <http://link-d3>; rel="fragment-script",'
                });

            mockTemplate.returns(
                '<fragment src="https://fragment/1"></fragment>' +
                    '<fragment id="f-2" async src="https://fragment/2"></fragment>' +
                    '<fragment async src="https://fragment/3"></fragment>' +
                    '<fragment src="https://fragment/4"></fragment>'
            );

            getResponse('http://localhost:8081/test')
                .then(response => {
                    assert.equal(
                        response.body,
                        '<html><head></head><body>' +
                            '<!-- Fragment #0 START -->' +
                            'hello many' +
                            '<script type="text/javascript" src="http://link-a3"></script>' +
                            '<script type="text/javascript" src="http://link-a2"></script>' +
                            '<script type="text/javascript" src="http://link-a1"></script>' +
                            '<!-- Fragment #0 END -->' +
                            '<!-- Async fragments are not fully implemented yet -->' +
                            '<!-- Async fragments are not fully implemented yet -->' +
                            '<!-- Fragment #9 START -->' +
                            'hello exactly three' +
                            '<script type="text/javascript" src="http://link-d3"></script>' +
                            '<script type="text/javascript" src="http://link-d2"></script>' +
                            '<script type="text/javascript" src="http://link-d1"></script>' +
                            '<!-- Fragment #9 END -->' +
                            '<!-- Fragment #3 "f-2" START -->' +
                            'hello single' +
                            '<script type="text/javascript" src="http://link-b1" data-fragment-id="f-2"></script>' +
                            '<!-- Fragment #3 "f-2" END -->' +
                            '<!-- Fragment #6 START -->' +
                            'hello exactly three async' +
                            '<script type="text/javascript" src="http://link-c3"></script>' +
                            '<script type="text/javascript" src="http://link-c2"></script>' +
                            '<script type="text/javascript" src="http://link-c1"></script>' +
                            '<!-- Fragment #6 END -->' +
                            '</body></html>'
                    );
                })
                .then(done, done);
        });

        it('should insert all 3 links to css from fragment link header', done => {
            nock('https://fragment')
                .get('/1')
                .reply(200, 'hello multiple styles ', {
                    Link:
                        '<http://script-link>; rel="fragment-script",<http://css1>; rel="stylesheet",<http://css2>; rel="stylesheet",<http://css3>; rel="stylesheet"'
                });
            mockTemplate.returns(
                '<fragment src="https://fragment/1"></fragment>'
            );

            getResponse('http://localhost:8081/test')
                .then(response => {
                    assert.equal(
                        stripComments(response.body),
                        '<html>' +
                            '<head></head>' +
                            '<body>' +
                            '<link rel="stylesheet" href="http://css1">' +
                            '<link rel="stylesheet" href="http://css2">' +
                            '<link rel="stylesheet" href="http://css3">' +
                            'hello multiple styles ' +
                            '<script type="text/javascript" src="http://script-link"></script>' +
                            '</body>' +
                            '</html>'
                    );
                })
                .then(done, done);
        });

        //TODO: add async fragments support
        it('should use loadCSS for async fragments for all 3 styles', done => {
            nock('https://fragment')
                .get('/1')
                .reply(200, 'hello multiple styles async', {
                    Link:
                        '<http://link1>; rel="stylesheet",<http://link2>; rel="stylesheet",<http://link3>; rel="stylesheet",<http://link4>; rel="fragment-script"'
                });

            mockTemplate.returns(
                '<fragment async src="https://fragment/1"></fragment>'
            );

            getResponse('http://localhost:8081/test')
                .then(response => {
                    assert.equal(
                        response.body,
                        '<html><head></head><body>' +
                            '<!-- Async fragments are not fully implemented yet -->' +
                            '<!-- Fragment #0 START -->' +
                            '<!-- Async fragments are not fully implemented yet: http://link1 -->' +
                            '<!-- Async fragments are not fully implemented yet: http://link2 -->' +
                            '<!-- Async fragments are not fully implemented yet: http://link3 -->' +
                            'hello multiple styles async' +
                            '<script type="text/javascript" src="http://link4"></script>' +
                            '<!-- Fragment #0 END -->' +
                            '</body></html>'
                    );
                })
                .then(done, done);
        });
    });

    describe('OpenTracing', () => {
        beforeEach(() => {
            tracer.clear();
        });

        function traceResults() {
            const { spans } = tracer.report();
            const tags = spans.map(s => s.tags());
            const logs = spans.map(s => s._logs[0]);
            return { tags, logs };
        }

        it('process request spans', done => {
            mockTemplate.returns('Test');
            getResponse('http://localhost:8080/test')
                .then(() => {
                    const { tags } = traceResults();
                    assert.equal(tags.length, 1);
                    assert.deepEqual(tags[0], {
                        'http.url': '/test',
                        'span.kind': 'server'
                    });
                })
                .then(done, done);
        });

        it('template error request spans & logs', done => {
            mockTemplate.returns('');
            getResponse('http://localhost:8080/error')
                .then(() => {
                    const { tags, logs } = traceResults();
                    assert.deepEqual(tags[0], {
                        'http.url': '/error',
                        'span.kind': 'server',
                        error: true,
                        'http.status_code': 500
                    });
                    assert.equal(logs.length, 1);
                })
                .then(done, done);
        });

        it('process request + primary fragment error spans', done => {
            nock('https://fragment')
                .get('/1')
                .reply(500);

            mockTemplate.returns(
                '<fragment id="" primary src="https://fragment/1"></fragment>'
            );

            getResponse('http://localhost:8080/test')
                .then(() => {
                    const { tags } = traceResults();
                    // Tailor should return error
                    assert.equal(tags[0].error, true);
                    // Primary fragment error
                    assert.deepEqual(tags[1], {
                        error: true,
                        primary: true,
                        'span.kind': 'client',
                        'http.url': 'https://fragment/1',
                        public: false,
                        async: false,
                        id: 'unnamed',
                        timeout: 3000
                    });
                })
                .then(done, done);
        });

        it('process request + fragment error', done => {
            nock('https://fragment')
                .get('/1')
                .reply(500);

            mockTemplate.returns(
                '<fragment id="test" src="https://fragment/1" timeout="200"></fragment>'
            );

            getResponse('http://localhost:8080/test')
                .then(() => {
                    const { tags } = traceResults();
                    assert.deepEqual(tags[1], {
                        'span.kind': 'client',
                        [Tags.HTTP_URL]: 'https://fragment/1',
                        id: 'test',
                        error: true,
                        primary: false,
                        async: false,
                        public: false,
                        timeout: 200
                    });
                })
                .then(done, done);
        });
    });

    describe('Custom "fragmentHooks" handling', () => {
        let serverCustomOptions;

        beforeEach(() => {
            nock('https://fragment')
                .get('/1')
                .reply(200, 'hello multiple', {
                    Link:
                        '<http://link1>; rel="stylesheet", <http://link2>; rel="fragment-script"'
                });

            mockTemplate.returns(
                '<fragment id="tstID" src="https://fragment/1"></fragment>'
            );
        });

        afterEach(done => {
            mockTemplate.reset();
            serverCustomOptions.close(done);
        });

        it('insertStart', done => {
            const tailor = createTailorInstance({
                fragmentHooks: {
                    insertStart: (stream, attributes, headers, index) => {
                        stream.write('#insertStart hook#');

                        try {
                            assert.equal(attributes.id, 'tstID');
                            assert.deepEqual(headers, {
                                link:
                                    '<http://link1>; rel="stylesheet", <http://link2>; rel="fragment-script"'
                            });
                            assert.equal(index, 0);
                        } catch (e) {
                            done(e);
                        }
                    }
                }
            });

            serverCustomOptions = http.createServer(tailor.requestHandler);
            serverCustomOptions.listen(8085, 'localhost', () => {
                getResponse('http://localhost:8085/test')
                    .then(response => {
                        assert.equal(
                            response.body,
                            '<html><head></head><body>' +
                                '<!-- Fragment #0 "tstID" START -->' +
                                '#insertStart hook#' +
                                'hello multiple' +
                                '<script type="text/javascript" src="http://link2" data-fragment-id="tstID"></script>' +
                                '<!-- Fragment #0 "tstID" END -->' +
                                '</body></html>'
                        );
                    })
                    .then(done, done);
            });
        });

        it('insertEnd', done => {
            const tailor = createTailorInstance({
                fragmentHooks: {
                    insertEnd: (stream, attributes, headers, index) => {
                        stream.write('#insertEnd hook#');

                        try {
                            assert.equal(attributes.id, 'tstID');
                            assert.deepEqual(headers, {
                                link:
                                    '<http://link1>; rel="stylesheet", <http://link2>; rel="fragment-script"'
                            });
                            assert.equal(index, 0);
                        } catch (e) {
                            done(e);
                        }
                    }
                }
            });

            serverCustomOptions = http.createServer(tailor.requestHandler);
            serverCustomOptions.listen(8085, 'localhost', () => {
                getResponse('http://localhost:8085/test')
                    .then(response => {
                        assert.equal(
                            response.body,
                            '<html><head></head><body>' +
                                '<!-- Fragment #0 "tstID" START -->' +
                                '<link rel="stylesheet" href="http://link1" data-fragment-id="tstID">' +
                                'hello multiple' +
                                '#insertEnd hook#' +
                                '<!-- Fragment #0 "tstID" END -->' +
                                '</body></html>'
                        );
                    })
                    .then(done, done);
            });
        });
    });
});
