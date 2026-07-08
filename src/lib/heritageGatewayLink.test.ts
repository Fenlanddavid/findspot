import { describe, expect, it } from 'vitest';
import { heritageGatewayUrl } from './heritageGatewayLink';

describe('heritageGatewayUrl', () => {
  it('returns the full beta map results URL for a 1000 m box', () => {
    expect(heritageGatewayUrl({ lat: 51.8787, lng: -0.4200, radiusM: 1000 })).toBe(
      'https://historicengland.org.uk/listing/heritage-gateway/results/?size=n_24_n&filters%5B0%5D%5Bfield%5D=layoutView&filters%5B0%5D%5Bvalues%5D%5B0%5D=map&filters%5B0%5D%5Btype%5D=all&filters%5B1%5D%5Bfield%5D=mapZoom&filters%5B1%5D%5Bvalues%5D%5B0%5D=14&filters%5B1%5D%5Btype%5D=all&filters%5B2%5D%5Bfield%5D=mapBoundsTopLeft&filters%5B2%5D%5Bvalues%5D%5B0%5D=51.88768%2C-0.43455&filters%5B2%5D%5Btype%5D=all&filters%5B3%5D%5Bfield%5D=mapBoundsBottomRight&filters%5B3%5D%5Bvalues%5D%5B0%5D=51.86972%2C-0.40545&filters%5B3%5D%5Btype%5D=all',
    );
  });

  it('computes latitude and longitude deltas at the equator and latitude 60', () => {
    const equator = heritageGatewayUrl({ lat: 0, lng: 0 });
    const latitude60 = heritageGatewayUrl({ lat: 60, lng: 0 });

    expect(equator).toContain('0.00898%2C-0.00898');
    expect(equator).toContain('-0.00898%2C0.00898');
    expect(latitude60).toContain('60.00898%2C-0.01797');
    expect(latitude60).toContain('59.99102%2C0.01797');
  });

  it('respects the radiusM override', () => {
    expect(heritageGatewayUrl({ lat: 0, lng: 0, radiusM: 500 })).toContain('0.00449%2C-0.00449');
  });

  it('does not leave raw brackets or commas in the query string', () => {
    const query = heritageGatewayUrl({ lat: 51.8787, lng: -0.4200 }).split('?')[1] ?? '';

    expect(query).not.toContain('[');
    expect(query).not.toContain(']');
    expect(query).not.toContain(',');
  });
});
