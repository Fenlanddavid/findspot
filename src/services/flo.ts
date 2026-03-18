
/**
 * Official PAS Finds Liaison Officer (FLO) Email Mapping by County/Region.
 */
export const FLO_MAPPING: Record<string, { name: string; email: string }> = {
  // South West
  "Cornwall": { name: "Laura Miucci", email: "finds@museumofcornishlife.co.uk" },
  "Devon": { name: "Brittany Walsh", email: "devon.finds@swheritage.org.uk" },
  "Dorset": { name: "Ciorstaidh Hayward Trevarthen", email: "finds@dorsetcouncil.gov.uk" },
  "Somerset": { name: "Laura Beckwith", email: "somerset.finds@swheritage.org.uk" },
  "Gloucestershire": { name: "Kurt Adams", email: "kurt.adams@bristol.gov.uk" },
  "Bristol": { name: "Kurt Adams", email: "kurt.adams@bristol.gov.uk" },
  "Wiltshire": { name: "PAS Wiltshire", email: "PAS@salisburymuseum.org.uk" },

  // South East
  "Kent": { name: "Isabelle Diggle", email: "isabelle.diggle@kent.gov.uk" },
  "Surrey": { name: "Simon Maslin", email: "simon.maslin@surreycc.gov.uk" },
  "East Sussex": { name: "Jane Clark", email: "flo@sussexpast.co.uk" },
  "West Sussex": { name: "Jane Clark", email: "flo@sussexpast.co.uk" },
  "Hampshire": { name: "Katie Hinds", email: "katie.hinds@hampshireculturaltrust.org.uk" },
  "Isle of Wight": { name: "Frank Basford", email: "frank.basford@iow.gov.uk" },
  "Oxfordshire": { name: "Anni Byard", email: "Anni.Byard@oxfordshire.gov.uk" },
  "Berkshire": { name: "Anni Byard", email: "Anni.Byard@oxfordshire.gov.uk" },
  "Buckinghamshire": { name: "Arwen Wood", email: "awood@discoverbucksmuseum.org" },
  "Milton Keynes": { name: "Arwen Wood", email: "awood@discoverbucksmuseum.org" },

  // East of England
  "Norfolk": { name: "PAS Norfolk", email: "finds.recording@norfolk.gov.uk" },
  "Suffolk": { name: "Andrew Brown", email: "andrew.brown2@suffolk.gov.uk" },
  "Essex": { name: "Lori Rogerson", email: "lori.rogerson@colchester.gov.uk" },
  "Cambridgeshire": { name: "PAS Cambridgeshire", email: "pasadministration@cambridgeshire.gov.uk" },
  "Peterborough": { name: "PAS Peterborough", email: "pasadministration@cambridgeshire.gov.uk" },
  "Bedfordshire": { name: "Matthew Fittock", email: "Matthew.Fittock@stalbans.gov.uk" },
  "Hertfordshire": { name: "Matthew Fittock", email: "Matthew.Fittock@stalbans.gov.uk" },

  // Midlands
  "Staffordshire": { name: "Teresa Gilmore", email: "Teresa.Gilmore@birminghammuseums.org.uk" },
  "West Midlands": { name: "Teresa Gilmore", email: "Teresa.Gilmore@birminghammuseums.org.uk" },
  "Worcestershire": { name: "Victoria Allnatt", email: "Victoria.Allnatt@birminghammuseums.org.uk" },
  "Warwickshire": { name: "Victoria Allnatt", email: "Victoria.Allnatt@birminghammuseums.org.uk" },
  "Herefordshire": { name: "Clara De-Sousa Cunha", email: "Clara.DeSousaCunha@birminghammuseums.org.uk" },
  "Shropshire": { name: "Clara De-Sousa Cunha", email: "Clara.DeSousaCunha@birminghammuseums.org.uk" },
  "Derbyshire": { name: "Megan King", email: "Meghan@derbymuseums.org" },
  "Nottinghamshire": { name: "Megan King", email: "Meghan@derbymuseums.org" },
  "Leicestershire": { name: "Megan Gard", email: "mgard@rutland.gov.uk" },
  "Rutland": { name: "Megan Gard", email: "mgard@rutland.gov.uk" },
  "Northamptonshire": { name: "Julie Cassidy", email: "jucassidy@northamptonshire.gov.uk" },

  // North
  "North Yorkshire": { name: "Rebecca Griffiths", email: "Rebecca.Morris@ymt.org.uk" },
  "East Riding of Yorkshire": { name: "Rebecca Griffiths", email: "Rebecca.Morris@ymt.org.uk" },
  "South Yorkshire": { name: "Amy Downes", email: "Amy.Downes@wyjs.org.uk" },
  "West Yorkshire": { name: "Amy Downes", email: "Amy.Downes@wyjs.org.uk" },
  "Lancashire": { name: "Alex Whitlock", email: "alex.whitlock@lancashire.gov.uk" },
  "Cumbria": { name: "Alex Whitlock", email: "alex.whitlock@lancashire.gov.uk" },
  "County Durham": { name: "Emma Morris", email: "Emma.Morris@durham.gov.uk" },
  "Tyne and Wear": { name: "Emma Morris", email: "Emma.Morris@durham.gov.uk" },
  "Lincolnshire": { name: "Martin Foreman", email: "Martin.Foreman@northlincs.gov.uk" },
  "Cheshire": { name: "PAS North West", email: "finds@liverpoolmuseums.org.uk" },
  "Greater Manchester": { name: "PAS North West", email: "finds@liverpoolmuseums.org.uk" },
  "Merseyside": { name: "PAS North West", email: "finds@liverpoolmuseums.org.uk" },

  // London & Wales
  "Greater London": { name: "Stuart Wyatt", email: "swyatt@museumoflondon.org.uk" },
  "London": { name: "Stuart Wyatt", email: "swyatt@museumoflondon.org.uk" },
  "Wales": { name: "PAS Cymru", email: "treasure@museumwales.ac.uk" }
};

/**
 * Finds the best FLO match based on a county string.
 */
export const getFLOForCounty = (county: string): { name: string; email: string } | null => {
  if (!county) return null;
  
  // Try exact match
  if (FLO_MAPPING[county]) return FLO_MAPPING[county];
  
  // Try partial match
  for (const key of Object.keys(FLO_MAPPING)) {
    if (county.includes(key) || key.includes(county)) {
      return FLO_MAPPING[key];
    }
  }
  
  return null;
};
