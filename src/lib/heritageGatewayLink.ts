export interface HgLinkInput {
  lat: number;
  lng: number;
  radiusM?: number;
}

const HERITAGE_GATEWAY_RESULTS_URL = 'https://historicengland.org.uk/listing/heritage-gateway/results/';

export function heritageGatewayUrl({ lat, lng, radiusM = 1000 }: HgLinkInput): string {
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.cos(lat * Math.PI / 180));
  const topLeft = `${(lat + dLat).toFixed(5)},${(lng - dLng).toFixed(5)}`;
  const bottomRight = `${(lat - dLat).toFixed(5)},${(lng + dLng).toFixed(5)}`;

  const params = new URLSearchParams();
  params.append('size', 'n_24_n');
  params.append('filters[0][field]', 'layoutView');
  params.append('filters[0][values][0]', 'map');
  params.append('filters[0][type]', 'all');
  params.append('filters[1][field]', 'mapZoom');
  params.append('filters[1][values][0]', '14');
  params.append('filters[1][type]', 'all');
  params.append('filters[2][field]', 'mapBoundsTopLeft');
  params.append('filters[2][values][0]', topLeft);
  params.append('filters[2][type]', 'all');
  params.append('filters[3][field]', 'mapBoundsBottomRight');
  params.append('filters[3][values][0]', bottomRight);
  params.append('filters[3][type]', 'all');

  return `${HERITAGE_GATEWAY_RESULTS_URL}?${params.toString()}`;
}
