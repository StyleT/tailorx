'use strict';

const parse5 = require('parse5');
const memoize = require('memoizee');
const treeAdapter = parse5.treeAdapters.htmlparser2;
const CustomSerializer = require('./serializer');

/**
 * Handles the parsing and serialization of templates. Also takes care of
 * merging the base and page templates
 */

module.exports = class Transform {
    constructor(handleTags, maxTemplates) {
        this.handleTags = handleTags;

        if (maxTemplates) {
            this._memoizeInternalMethods(maxTemplates);
        } else {
            this._bindInternalMethods();
        }
    }

    _memoizeInternalMethods(maxTemplates) {
        const commonMemoizeOptions = {
            length: 1,
            max: maxTemplates
        };

        this._ignore = memoize(
            this._ignoreBeforeParsing.bind(this),
            commonMemoizeOptions
        );
        this._restore = memoize(
            this._restoreAfterParsing.bind(this),
            commonMemoizeOptions
        );
        this._parse = memoize(parse5.parse.bind(null), commonMemoizeOptions);
        this._parseFragment = memoize(
            parse5.parseFragment.bind(null),
            commonMemoizeOptions
        );
    }

    _bindInternalMethods() {
        this._ignore = this._ignoreBeforeParsing.bind(this);
        this._restore = this._restoreAfterParsing.bind(this);
        this._parse = parse5.parse.bind(null);
        this._parseFragment = parse5.parseFragment.bind(null);
    }

    /**
     * Parse and serialize the html.
     *
     * @param {string} baseTemplate - Base template that contains all the necessary tags and fragments for the given page (Used by multiple pages)
     * @param {string=} childTemplate - The current page template that gets merged in to the base template
     * @returns {Array} Array consiting of Buffers and Objects
     */
    applyTransforms(baseTemplate, childTemplate, fullRendering) {
        const [template, ignoredParts] = this._ignore(baseTemplate);
        const options = { treeAdapter };

        const rootNodes = fullRendering
            ? this._parse(template, options)
            : this._parseFragment(template, options);

        const slotMap =
            childTemplate && typeof childTemplate === 'string'
                ? this._groupSlots(parse5.parseFragment(childTemplate, options))
                : new Map();

        const serializerOptions = {
            treeAdapter,
            slotMap,
            handleTags: this.handleTags,
            fullRendering
        };

        const serializer = new CustomSerializer(rootNodes, serializerOptions);

        return this._restore(ignoredParts, serializer.serialize());
    }

    /**
     * Ignore special parts of a base template which marked with the help of special HTML comments:
     * <!-- TailorX: Ignore during parsing START --> and <!-- TailorX: Ignore during parsing END -->
     * before and after a content which you want to ignore during parsing to speed up transforming of a base template
     *
     * @example <!-- TailorX: Ignore during parsing START --><div class='example-class>Example</div><!-- TailorX: Ignore during parsing END -->
     *
     * @param {String} baseTemplate - Base template that contains all the necessary tags and fragments for the given page (Used by multiple pages)
     * @returns {Array} Array consiting of a template without ignored parts as a String and ignored parts as an Object
     */
    _ignoreBeforeParsing(baseTemplate) {
        const parts = baseTemplate.split(
            /<!-- TailorX: Ignore during parsing START -->|<!-- TailorX: Ignore during parsing END -->/gm
        );
        const ignoredParts = {};

        const joinedParts = parts.reduce((parts, part, index) => {
            if (index % 2 === 0) {
                return parts.concat(part);
            }

            ignoredParts[index] = part;

            return parts.concat(
                `<!-- TailorX: Ignored content during parsing #${index} -->`
            );
        });

        return [joinedParts, ignoredParts];
    }

    /**
     * Restore base template's special parts after ignoring them by @method _ignoreBeforeParsing
     *
     * @param {Object} ignoredParts - Base template's ignored parts
     * @param {Array} chunks - Array consiting of Buffers and Objects
     * @returns {Array} Array consiting of Buffers and Objects
     */
    _restoreAfterParsing(ignoredParts, chunks) {
        return chunks.map(chunk => {
            const isBuffer = chunk instanceof Buffer;
            const part = isBuffer ? chunk.toString('utf-8') : chunk;

            if (typeof part !== 'string') {
                return chunk;
            }

            const restoredPart = part.replace(
                /<!-- TailorX: Ignored content during parsing #(\d) -->/gm,
                (match, index) => {
                    if (typeof ignoredParts[index] !== 'string') {
                        throw new Error(
                            `TailorX can not find an ignored part ${index} of the current template during restoring!`
                        );
                    }

                    return ignoredParts[index];
                }
            );

            return isBuffer ? Buffer.from(restoredPart, 'utf-8') : restoredPart;
        });
    }

    /**
     * Group all the nodes after parsing the child template. Nodes with unnamed slots are
     * added to default slots
     *
     * @param {Object} root - The root node of the child template
     * @returns {Map} Map with keys as slot attribute name and corresponding values consisting of array of matching nodes
     */
    _groupSlots(root) {
        const slotMap = new Map([['default', []]]);
        const nodes = treeAdapter.getChildNodes(root);
        nodes.forEach(node => {
            if (!treeAdapter.isTextNode(node)) {
                const { slot = 'default' } = node.attribs || {};
                const slotNodes = slotMap.get(slot) || [];
                const updatedSlotNodes = [...slotNodes, node];
                slotMap.set(slot, updatedSlotNodes);
                this._pushText(node.next, updatedSlotNodes);
                node.attribs && delete node.attribs.slot;
            }
        });
        return slotMap;
    }

    /**
     * Add the text node to the Slot Map
     *
     * @param {Object} nextNode
     * @param {Array} slot - Array of matching nodes
     */
    _pushText(nextNode, slot) {
        if (nextNode && treeAdapter.isTextNode(nextNode)) {
            slot.push(nextNode);
        }
    }
};
