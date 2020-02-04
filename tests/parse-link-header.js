'use strict';

const parseLinkHeader = require('../lib/parse-link-header');
const assert = require('assert');

describe('Parse Link Header', () => {
    it('returns uri and rel of the passed header', () => {
        const linkHeader =
            '<http://a.com/app.js>; rel="script",<http://a.com/app.css>; rel="stylesheet"';

        assert.deepStrictEqual(parseLinkHeader(linkHeader), [
            { uri: 'http://a.com/app.js', rel: 'script', params: {} },
            { uri: 'http://a.com/app.css', rel: 'stylesheet', params: {} }
        ]);
    });

    it('parse attributes other than rel and uri', () => {
        const linkHeader =
            '<http://a.com/app.js>; rel="script"; param1 = value1; param2 = "value2"; param3=value3';

        assert.deepStrictEqual(parseLinkHeader(linkHeader), [
            {
                uri: 'http://a.com/app.js',
                rel: 'script',
                params: { param1: 'value1', param2: 'value2', param3: 'value3' }
            }
        ]);
    });

    it('correctly handles invalid header links, for backward compatibility reasons', () => {
        const linkHeader = 'http://a.com/app.js; rel=script';

        assert.deepStrictEqual(parseLinkHeader(linkHeader), [
            { uri: 'http://a.com/app.js', rel: 'script', params: {} }
        ]);
    });

    it('filters invalid rel attributes', () => {
        const linkHeader =
            '<http://a.com/app.js>; aaa="bbb" ; rel="script";, <http://a.com/app1.css>; rel="stylesheet", <http://a.com/app2.css>;, <http://a.com/app3.css>, <http://a.com/app4.css>; rel=""';

        assert.deepStrictEqual(parseLinkHeader(linkHeader), [
            {
                uri: 'http://a.com/app.js',
                rel: 'script',
                params: { aaa: 'bbb' }
            },
            { uri: 'http://a.com/app1.css', rel: 'stylesheet', params: {} }
        ]);
    });

    it('do not modify query parms in link urls', () => {
        const linkHeader = '<http://a.com/app.js?nocache=1>; rel="script";';

        assert.deepStrictEqual(parseLinkHeader(linkHeader), [
            { uri: 'http://a.com/app.js?nocache=1', rel: 'script', params: {} }
        ]);
    });

    it('correctly handles empty link header', () => {
        const linkHeader = '';

        assert.deepStrictEqual(parseLinkHeader(linkHeader), []);
    });
});
