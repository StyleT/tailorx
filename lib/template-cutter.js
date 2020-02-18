'use strict';

const MARKED_PARTS_TO_IGNORE = /<!-- TailorX: Ignore during parsing START -->.*?<!-- TailorX: Ignore during parsing END -->/gims;
const IGNORED_PART_WITH_INDEX = /<!-- TailorX: Ignored content during parsing #(\d+) -->/gm;

function replaceIgnorePart(ignoredPartIndex) {
    return `<!-- TailorX: Ignored content during parsing #${ignoredPartIndex} -->`;
}

class TemplateCutter {
    constructor() {
        this.ignoredParts = [];
    }

    /**
     * Cut base templates special parts which marked with the help of special HTML comments:
     * <!-- TailorX: Ignore during parsing START --> and <!-- TailorX: Ignore during parsing END -->
     * before and after a content which you want to ignore during parsing to speed up transforming of a base template
     *
     * @example <!-- TailorX: Ignore during parsing START --><div class='example-class>Example</div><!-- TailorX: Ignore during parsing END -->
     *
     * @param {String} baseTemplate - Base template that contains all the necessary tags and fragments for the given page (Used by multiple pages)
     * @returns {String} Base template without ignored parts
     */
    cut(baseTemplate) {
        return baseTemplate.replace(MARKED_PARTS_TO_IGNORE, match => {
            const ignorePartsLength = this.ignoredParts.push(match);
            return replaceIgnorePart(ignorePartsLength - 1);
        });
    }

    /**
     * Restore base template's special parts after ignoring them by @method _cut
     *
     * @param {Array} ignoredParts - Base template's ignored parts
     * @param {Array} chunks - Array consiting of Buffers and Objects
     * @returns {Array} Array consiting of Buffers and Objects
     */
    restore(chunks) {
        const restoredChunks = chunks.map(chunk => {
            const isBuffer = chunk instanceof Buffer;
            const part = isBuffer ? chunk.toString('utf-8') : chunk;

            if (typeof part !== 'string') {
                return chunk;
            }

            const restoredPart = part.replace(
                IGNORED_PART_WITH_INDEX,
                (match, ignoredPartIndex) => {
                    const ignoredPart = this.ignoredParts[ignoredPartIndex];

                    if (typeof ignoredPart !== 'string') {
                        throw new Error(
                            `TailorX can not find an ignored part ${ignoredPartIndex} of the current template during restoring!`
                        );
                    }

                    return ignoredPart;
                }
            );

            return isBuffer ? Buffer.from(restoredPart, 'utf-8') : restoredPart;
        });

        this.ignoredParts = [];

        return restoredChunks;
    }
}

module.exports = TemplateCutter;
