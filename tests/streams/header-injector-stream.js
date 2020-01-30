'use strict';
const assert = require('assert');
const HeadInjectorSream = require('../../lib/streams/head-injector-stream');

describe('HeadInjectorSream', () => {
    it('injects title and meta tags at the end of the "head" tag', done => {
        const PAGE1 = '<!DOCTYPE html><html><head>';
        const PAGE2 = '</head><body></body></html>';

        const TITLE = '<title>TEST TITLE</title>';
        const META_TAGS =
            '<meta name="description" content="Free Web tutorials"><meta name="keywords" content="HTML,CSS,XML,JavaScript">';

        const PAGE_RES = `<!DOCTYPE html><html><head>${TITLE}${META_TAGS}</head><body></body></html>`;

        const headers = {
            'x-head-title': Buffer.from(TITLE, 'utf-8').toString('base64'),
            'x-head-meta': Buffer.from(META_TAGS, 'utf-8').toString('base64')
        };

        let dataBuf = '';

        const st = new HeadInjectorSream(headers);
        st.on('data', data => {
            dataBuf += data;
        });
        st.on('end', () => {
            assert.equal(dataBuf, PAGE_RES);
            done();
        });
        st.write(Buffer.from(PAGE1));
        st.write(Buffer.from(PAGE2));
        st.end();
    });

    it('injects title and meta tags at the position of "title" tag', done => {
        const PAGE =
            '<!DOCTYPE html><html><head>\n<title>\nTPL_TITLE\n</title>\n<base href="/" target="_blank">\n</head><body></body></html>';

        const TITLE = '<title>TEST TITLE</title>';
        const META_TAGS =
            '<meta name="description" content="Free Web tutorials"><meta name="keywords" content="HTML,CSS,XML,JavaScript">';

        const PAGE_RES = `<!DOCTYPE html><html><head>\n${TITLE}${META_TAGS}\n<base href="/" target="_blank">\n</head><body></body></html>`;

        const headers = {
            'x-head-title': Buffer.from(TITLE, 'utf-8').toString('base64'),
            'x-head-meta': Buffer.from(META_TAGS, 'utf-8').toString('base64')
        };

        const st = new HeadInjectorSream(headers);
        st.on('data', data => {
            assert.equal(data, PAGE_RES);
            done();
        });
        st.write(Buffer.from(PAGE));
    });

    it("doesn't break anything", done => {
        const PAGE1 = '<!DOCTYPE html><html><head>';
        const PAGE2 = '</head><body></body></html>';
        const PAGE = PAGE1 + PAGE2;

        const headers = {};

        let dataBuf = '';

        const st = new HeadInjectorSream(headers);
        st.on('data', data => {
            dataBuf += data;
        });
        st.on('end', () => {
            assert.equal(dataBuf, PAGE);
            done();
        });
        st.write(Buffer.from(PAGE1));
        st.write(Buffer.from(PAGE2));
        st.end();
    });
});
