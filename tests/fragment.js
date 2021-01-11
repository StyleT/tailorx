'use strict';

const Fragment = require('../lib/fragment');
const assert = require('assert');
const getOptions = tag => {
    return {
        tag,
        context: {},
        index: false,
        requestFragment: () => {}
    };
};

describe('Fragment', () => {
    it('computed attributes are correctly initiliazed', () => {
        const attributes = {
            id: 'foo',
            src: 'https://fragment',
            async: true,
            timeout: '4000',
            custom: 'bar',
            'ignore-invalid-ssl': true
        };

        const expected = {
            id: attributes.id,
            url: attributes.src,
            async: attributes.async,
            forwardQuerystring: false,
            returnHeaders: false,
            timeout: 4000,
            primary: false,
            public: false,
            ignoreInvalidSsl: attributes['ignore-invalid-ssl'],
            custom: attributes.custom
        };

        const tag = { attributes };
        const fragment = new Fragment(getOptions(tag));
        const fattributes = fragment.attributes;

        assert.deepEqual(fattributes, expected);
    });
});
