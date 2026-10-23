const { test } = require('node:test');
const assert = require('node:assert');
const { buildBrowseTree } = require('../lib/settings-transform');

test('buildBrowseTree builds the nested station->year->month->day->hours tree', () => {
    const streams = [
        {
            name: 'glowfm',
            logs: {
                2026: {
                    10: {
                        23: ['14', '15'],
                    },
                },
            },
        },
    ];

    const tree = buildBrowseTree(streams);

    assert.deepStrictEqual(tree, {
        glowfm: {
            2026: {
                10: {
                    23: ['14', '15'],
                },
            },
        },
    });
});

test('buildBrowseTree keys underscored station names verbatim (no _ -> space)', () => {
    const streams = [
        {
            name: 'Glow_FM',
            logs: {
                2026: {
                    10: {
                        23: ['14'],
                    },
                },
            },
        },
    ];

    const tree = buildBrowseTree(streams);

    assert.ok(Object.prototype.hasOwnProperty.call(tree, 'Glow_FM'));
    assert.strictEqual(Object.prototype.hasOwnProperty.call(tree, 'Glow FM'), false);
});

test('buildBrowseTree returns {} for an empty array without throwing', () => {
    assert.deepStrictEqual(buildBrowseTree([]), {});
});
