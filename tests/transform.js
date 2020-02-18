'use strict';

const assert = require('assert');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noPreserveCache();

describe('Transform', () => {
    let Transform;
    let transformInstance;

    class MockSerializer {
        constructor(node, options) {
            this.node = node;
            this.options = options;
        }
        serialize() {}
    }

    const serialize = sinon.stub();
    const mockSerializer = sinon.spy(function() {
        return sinon.createStubInstance(MockSerializer, {
            serialize
        });
    });
    const handleTags = ['x-tag'];
    const maxTemplates = 1;

    beforeEach(() => {
        serialize.withArgs().returns([]);
        Transform = proxyquire('../lib/transform', {
            './serializer': mockSerializer
        });
        transformInstance = new Transform(handleTags, maxTemplates);
    });

    afterEach(() => {
        serialize.reset();
        mockSerializer.resetHistory();
    });

    it('should make child Templates optional', () => {
        const childTemplate = '';
        transformInstance.applyTransforms('', childTemplate);
        assert.equal(mockSerializer.callCount, 1); // No errros are thrown
    });

    it('should put tags in default slot if type is not defined', () => {
        const childTemplate = '<custom slot="" name="custom element"></custom>';
        transformInstance.applyTransforms('', childTemplate);
        const slotMap = mockSerializer.args[0][1].slotMap;
        assert(slotMap.has('default'));
    });

    it('should put comment tags in default slot', () => {
        const childTemplate = '<!-- nice comment -->';
        transformInstance.applyTransforms('', childTemplate);
        const slotMap = mockSerializer.args[0][1].slotMap;
        assert(slotMap.has('default'));
    });

    it('should group slots based on slot types for child Templates', () => {
        const childTemplate = `
            <meta slot="head">
            <custom name="custom element"></custom>
            <fragment slot="body"></fragment>
        `;
        transformInstance.applyTransforms('', childTemplate);
        const slotMap = mockSerializer.args[0][1].slotMap;
        assert.equal(slotMap.size, 3);
        assert.ok(slotMap.get('default'));
        assert.ok(slotMap.has('head'));
        assert.ok(slotMap.has('body'));
    });

    it('should group text nodes along with the childTemplate nodes', () => {
        const childTemplate = `
            <meta slot="head">
            <fragment></fragment>
        `;
        transformInstance.applyTransforms('', childTemplate);
        const slotMap = mockSerializer.args[0][1].slotMap;
        assert.equal(slotMap.size, 2);
        // Text node that symbolizes next line of HTML
        assert.equal(slotMap.get('default')[1].type, 'text');
        assert.equal(slotMap.get('head')[1].type, 'text');
    });

    it('should call serializer with proper options', () => {
        transformInstance.applyTransforms('', '');
        const options = mockSerializer.args[0][1];
        assert(options.slotMap instanceof Map);
        assert(options.treeAdapter instanceof Object);
        assert.equal(options.handleTags, handleTags);
    });

    it('should return correct serialized chunks', () => {
        const baseTemplate =
            '<!DOCTYPE html>' +
            '<html>' +
            '<head>' +
            '<meta charset="utf-8" />' +
            '<meta name="viewport" content="width=device-width,initial-scale=1" />' +
            '</head>' +
            '<body>' +
            '<!-- TailorX: Ignore during parsing START -->' +
            '<div id="ingored-first-slot">' +
            '<slot name="ingored-first-slot"></slot>' +
            '</div>' +
            '<!-- TailorX: Ignore during parsing END -->' +
            '<div id="navbar">' +
            '<slot name="navbar"></slot>' +
            '</div>' +
            '<div id="body">' +
            '<slot name="body"></slot>' +
            '</div>' +
            '<!-- TailorX: Ignore during parsing START -->' +
            '<div id="ingored-second-slot">' +
            '<slot name="ingored-second-slot"></slot>' +
            '</div>' +
            '<!-- TailorX: Ignore during parsing END -->' +
            '<div id="live-chat">' +
            '<slot name="live-chat"></slot>' +
            '</div>' +
            '<div id="footer">' +
            '<slot name="footer"></slot>' +
            '</div>' +
            '</body>' +
            '</html>';

        const childTemplate =
            '<fragment' +
            'id="@portal/navbar"' +
            'slot="navbar"' +
            'src="http://127.0.0.1:3001/api/fragment/navbar"' +
            'timeout="3000">' +
            '</fragment>' +
            '<fragment' +
            'id="@portal/body"' +
            'slot="body"' +
            'src="http://127.0.0.1:3001/api/fragment/body"' +
            'timeout="3000" primary="true">' +
            '</fragment>' +
            '<fragment' +
            'id="@portal/footer"' +
            'slot="footer"' +
            'src="http://127.0.0.1:3001/api/fragment/footer"' +
            'timeout="3000">' +
            '</fragment>' +
            '<fragment' +
            'id="@portal/live-chat"' +
            'slot="live-chat"' +
            'src="http://127.0.0.1:3001/api/fragment/live-chat"' +
            'timeout="3000">' +
            '</fragment>';

        const chunks = [
            '<!DOCTYPE html>',
            '<html>',
            Buffer.from(
                '<head>' +
                    '<meta charset="utf-8" />' +
                    '<meta name="viewport" content="width=device-width,initial-scale=1" />' +
                    '</head>',
                'utf-8'
            ),
            Buffer.from('<body>', 'utf-8'),
            '<!-- TailorX: Ignored content during parsing #0 -->' +
                '<div id="navbar">' +
                '<slot name="navbar"></slot>' +
                '</div>',
            Buffer.from(`{}`, 'utf-8'),
            Buffer.from(
                '<div id="body">' +
                    '<slot name="body"></slot>' +
                    '</div>' +
                    '<!-- TailorX: Ignored content during parsing #1 -->' +
                    '<div id="live-chat">' +
                    '<slot name="live-chat"></slot>' +
                    '</div>',
                'utf-8'
            ),
            '<div id="footer">' +
                '<slot name="footer"></slot>' +
                '</div>' +
                '</body>' +
                '</html>'
        ];

        serialize.withArgs().returns(chunks);

        const chunksAfterTransform = transformInstance.applyTransforms(
            baseTemplate,
            childTemplate
        );

        assert.equal(
            chunksAfterTransform[4],
            '<!-- TailorX: Ignore during parsing START -->' +
                '<div id="ingored-first-slot">' +
                '<slot name="ingored-first-slot"></slot>' +
                '</div>' +
                '<!-- TailorX: Ignore during parsing END -->' +
                '<div id="navbar">' +
                '<slot name="navbar"></slot>' +
                '</div>'
        );
        assert.equal(
            chunksAfterTransform[6].toString('utf-8'),
            '<div id="body">' +
                '<slot name="body"></slot>' +
                '</div>' +
                '<!-- TailorX: Ignore during parsing START -->' +
                '<div id="ingored-second-slot">' +
                '<slot name="ingored-second-slot"></slot>' +
                '</div>' +
                '<!-- TailorX: Ignore during parsing END -->' +
                '<div id="live-chat">' +
                '<slot name="live-chat"></slot>' +
                '</div>'
        );
        assert.equal(chunksAfterTransform.length, chunks.length);
    });

    it('should throw an error when transform can not find an ignored part while restoring a template', () => {
        const baseTemplate =
            '<!DOCTYPE html>' +
            '<html>' +
            '<head>' +
            '<meta charset="utf-8" />' +
            '<meta name="viewport" content="width=device-width,initial-scale=1" />' +
            '</head>' +
            '<body>' +
            '<!-- TailorX: Ignore during parsing START -->' +
            '<div id="ingored-first-slot">' +
            '<slot name="ingored-first-slot"></slot>' +
            '</div>' +
            '<!-- TailorX: Ignore during parsing END -->' +
            '</body>' +
            '</html>';

        const childTemplate = '';

        const chunks = [
            '<!DOCTYPE html>',
            '<html>',
            Buffer.from(
                '<head>' +
                    '<meta charset="utf-8" />' +
                    '<meta name="viewport" content="width=device-width,initial-scale=1" />' +
                    '</head>',
                'utf-8'
            ),
            Buffer.from('<body>', 'utf-8'),
            '<!-- TailorX: Ignored content during parsing #0 -->' +
                '<!-- TailorX: Ignored content during parsing #3 -->' +
                '</body>' +
                '</html>'
        ];

        serialize.withArgs().returns(chunks);

        let catchedError;

        try {
            transformInstance.applyTransforms(baseTemplate, childTemplate);
        } catch (error) {
            catchedError = error;
        }

        assert.equal(
            catchedError.message,
            'TailorX can not find an ignored part 3 of the current template during restoring!'
        );
    });
});
