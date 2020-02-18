'use strict';

const assert = require('assert');
const TemplateCutter = require('../lib/template-cutter');

describe('TemplateCutter', () => {
    let templateCutter;

    beforeEach(() => {
        templateCutter = new TemplateCutter();
    });

    it('should cut and restore a base template and ignore comment tags without a pair', () => {
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
            '<!-- TailorX: Ignore during parsing START -->' +
            '<div id="footer">' +
            '<slot name="footer"></slot>' +
            '</div>' +
            '</body>' +
            '</html>';

        const correctCuttedBaseTemplate =
            '<!DOCTYPE html>' +
            '<html>' +
            '<head>' +
            '<meta charset="utf-8" />' +
            '<meta name="viewport" content="width=device-width,initial-scale=1" />' +
            '</head>' +
            '<body>' +
            '<!-- TailorX: Ignored content during parsing #0 -->' +
            '<!-- TailorX: Ignore during parsing END -->' +
            '<div id="navbar">' +
            '<slot name="navbar"></slot>' +
            '</div>' +
            '<div id="body">' +
            '<slot name="body"></slot>' +
            '</div>' +
            '<!-- TailorX: Ignored content during parsing #1 -->' +
            '<div id="live-chat">' +
            '<slot name="live-chat"></slot>' +
            '</div>' +
            '<!-- TailorX: Ignore during parsing START -->' +
            '<div id="footer">' +
            '<slot name="footer"></slot>' +
            '</div>' +
            '</body>' +
            '</html>';

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
                '<!-- TailorX: Ignore during parsing END -->' +
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
            '<!-- TailorX: Ignore during parsing START -->' +
                '<div id="footer">' +
                '<slot name="footer"></slot>' +
                '</div>' +
                '</body>' +
                '</html>'
        ];

        const correctRestoredFirstSlot =
            '<!-- TailorX: Ignore during parsing START -->' +
            '<div id="ingored-first-slot">' +
            '<slot name="ingored-first-slot"></slot>' +
            '</div>' +
            '<!-- TailorX: Ignore during parsing END -->' +
            '<!-- TailorX: Ignore during parsing END -->' +
            '<div id="navbar">' +
            '<slot name="navbar"></slot>' +
            '</div>';
        const correctRestoredSecondSlot =
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
            '</div>';

        const cuttedBaseTemplate = templateCutter.cut(baseTemplate);
        const restoredChunks = templateCutter.restore(chunks);

        assert.equal(cuttedBaseTemplate, correctCuttedBaseTemplate);
        assert.equal(restoredChunks[4], correctRestoredFirstSlot);
        assert.equal(
            restoredChunks[6].toString('utf-8'),
            correctRestoredSecondSlot
        );
        assert.equal(restoredChunks.length, chunks.length);
        assert.equal(templateCutter.ignoredParts.length, 0);
    });

    it('should throw an error when a cutter can not find an ignored part while restoring a base template', () => {
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
                '<!-- TailorX: Ignored content during parsing #100 -->' +
                '</body>' +
                '</html>'
        ];

        let catchedError;

        templateCutter.cut(baseTemplate);

        try {
            templateCutter.restore(chunks);
        } catch (error) {
            catchedError = error;
        }

        assert.equal(
            catchedError.message,
            'TailorX can not find an ignored part 100 of the current template during restoring!'
        );
    });
});
