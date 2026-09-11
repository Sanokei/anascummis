import { describe, it, expect } from 'vitest';
import { renderKeyFromPath } from '../../src/worker/routes/design';

/**
 * The render route's path handling.
 *
 * This is the only place a client-supplied string contributes to a storage key,
 * so it is the only place a traversal could be assembled. The key is rebuilt
 * here rather than accepted from the caller, and the session check downstream
 * compares it against that session's own rows — which means a key that is
 * syntactically fine but belongs to nobody is refused there. What this file
 * covers is the earlier gate: nothing that could name a key outside the design
 * prefix gets through at all.
 *
 * Tested as a function rather than over HTTP because that is where the decision
 * is; an HTTP test would cover Hono's routing, not this.
 */

const LAB = 'design_0f1e2d3c4b5a69788796a5b4c3d2e1f0';
const REV = 'rev_0f1e2d3c4b5a69788796a5b4c3d2e1f0';

describe('renderKeyFromPath', () => {
  it('rebuilds the key the store wrote', () => {
    expect(renderKeyFromPath(LAB, REV, 'front.png')).toBe(`design/${LAB}/${REV}/front.png`);
    expect(renderKeyFromPath(LAB, REV, 'mesh.glb')).toBe(`design/${LAB}/${REV}/mesh.glb`);
    expect(renderKeyFromPath(LAB, REV, 'sheet.png')).toBe(`design/${LAB}/${REV}/sheet.png`);
  });

  it('refuses anything that could climb out of the prefix', () => {
    // Each of these is a segment a caller could actually send. None may reach
    // the point of being concatenated into a key.
    const hostile = [
      '../../etc/passwd',
      '..',
      '../front.png',
      '....//front.png',
      '/etc/passwd',
      'front.png/../../../../other',
      'front.png%2f..%2f..',
      '..%2ffront.png',
      'front.png\u0000',
      ' front.png',
      'front.png ',
    ];
    for (const file of hostile) {
      expect(renderKeyFromPath(LAB, REV, file), `file: ${file}`).toBeNull();
    }
  });

  it('refuses a lab or revision id that is not one of ours', () => {
    // A session id, a traversal, an empty string, and a plausible-looking
    // arbitrary key all have to fail: the shapes are the ids `randomId` writes,
    // nothing else.
    expect(renderKeyFromPath('../labs', REV, 'front.png')).toBeNull();
    expect(renderKeyFromPath('', REV, 'front.png')).toBeNull();
    expect(renderKeyFromPath('labs', REV, 'front.png')).toBeNull();
    expect(renderKeyFromPath(LAB, 'ws:session:name', 'front.png')).toBeNull();
    expect(renderKeyFromPath(LAB, '', 'front.png')).toBeNull();
    expect(renderKeyFromPath(LAB, '../..', 'front.png')).toBeNull();
  });

  it('refuses a file extension the route does not serve', () => {
    // A GLB and a PNG are what a revision produces. An SVG here would be a
    // same-origin document rather than an image, which is a different thing to
    // serve and is not what this route is for.
    for (const file of ['front.svg', 'front.jpg', 'front', 'front.png.exe', '.png', 'front.PNG']) {
      expect(renderKeyFromPath(LAB, REV, file), `file: ${file}`).toBeNull();
    }
  });

  it('never returns a key outside the design prefix', () => {
    // The property behind all the cases above, stated once: whatever gets
    // through starts with the prefix and has exactly three segments after it.
    const accepted = [
      [LAB, REV, 'front.png'],
      [LAB, REV, 'mesh.glb'],
      ['design_a', 'rev_b', 'iso.png'],
    ] as const;
    for (const [lab, rev, file] of accepted) {
      const key = renderKeyFromPath(lab, rev, file);
      expect(key).not.toBeNull();
      expect(key!.startsWith('design/')).toBe(true);
      expect(key!.split('/')).toHaveLength(4);
      expect(key!.includes('..')).toBe(false);
    }
  });
});
