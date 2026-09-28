import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'node:util';
import { ReadableStream } from 'node:stream/web';

if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = TextEncoder;
}
if (typeof global.TextDecoder === 'undefined') {
  // @ts-expect-error — jsdom polyfill
  global.TextDecoder = TextDecoder;
}
if (typeof global.ReadableStream === 'undefined') {
  // @ts-expect-error — jsdom polyfill
  global.ReadableStream = ReadableStream;
}

// Пакет ymap3-components удалён при переходе на OSM/leaflet — мок виртуальный,
// иначе jest.setup падает с «Cannot find module» и не запускается ни один тест.
// Тесты карт на react-leaflet мокают react-leaflet локально
// (см. tests/unit/track-polyline.test.tsx).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
jest.mock(
  'ymap3-components',
  () => {
    const React = require('react');
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      YMap: ({ children }: any) => React.createElement('div', { 'data-testid': 'ymap' }, children),
      YMapDefaultSchemeLayer: () => null,
      YMapDefaultFeaturesLayer: () => null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      YMapControls: ({ children }: any) => React.createElement('div', null, children),
      YMapZoomControl: () => null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      YMapMarker: ({ coordinates, children }: any) =>
        React.createElement(
          'div',
          {
            'data-testid': 'marker',
            'data-coords': JSON.stringify(coordinates),
          },
          children,
        ),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      YMapFeature: ({ geometry }: any) =>
        React.createElement('div', {
          'data-testid': 'feature',
          'data-type': geometry?.type,
        }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      YMapComponentsProvider: ({ children }: any) =>
        React.createElement(React.Fragment, null, children),
    };
  },
  { virtual: true },
);
