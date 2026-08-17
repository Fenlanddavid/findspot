export const LAND_ACCESS_GUIDANCE_VERSION = '2026-08-16';

export type LandAccessSection = {
  id: string;
  title: string;
  summary: string;
  paragraphs: string[];
  points: string[];
};

export const LAND_ACCESS_SECTIONS: LandAccessSection[] = [
  {
    id: 'who-can-say-yes',
    title: 'Who can actually grant permission',
    summary: 'The registered owner and the person farming the land may be different people.',
    paragraphs: [
      'Many farms are tenanted or managed for somebody else. A registered proprietor may not occupy the land, choose access times, manage crops or control livestock.',
      'Ask whether the person you are speaking to can authorise access and detecting, and who needs to agree what happens to removed objects. Where owner and occupier differ, consult both before detecting and record both positions in writing.',
    ],
    points: [
      'The occupier or tenant normally controls day-to-day access and land management.',
      'The owner may need to agree ownership, retention or sale of anything removed from the land.',
      'A manager, agent or contractor may need to refer the request elsewhere. Do not treat that as permission.',
    ],
  },
  {
    id: 'finding-who-to-ask',
    title: 'Finding out who to ask',
    summary: 'Start with local, public and consent-based routes.',
    paragraphs: [
      'Farm signage, a farm shop or public business contact, parish notices, local farming contacts and a genuine introduction from somebody you already know are often more useful than an ownership search.',
      'A detecting club or local Finds Liaison Officer may explain local practice, but should not be expected to disclose private contact details or recommend land for detecting.',
    ],
    points: [
      'Ask an existing landowner contact whether they are comfortable making an introduction; do not use their name without consent.',
      'HM Land Registry can identify the registered owner of registered land in England and Wales through a user-run, paid title-register lookup.',
      'A title result does not identify the occupier. No search result means ownership is unknown, not that the land is unowned or available.',
    ],
  },
  {
    id: 'the-approach',
    title: 'The approach',
    summary: 'Lead with care for the land and its history, not finds or value.',
    paragraphs: [
      'Use an appropriate public or business contact route, an introduction, or a conversation when the farmer is already available. Do not arrive unannounced at a private home.',
      'Keep the first request short. Explain the record you keep, the report you will provide, how you look after the ground and that you will follow the land manager’s instructions.',
    ],
    points: [
      'Avoid harvest, lambing, difficult ground conditions and severe weather. If the timing is bad, leave it there.',
      'Do not lead with monetary value, Treasure rewards or a proposed split. Those terms matter later, before detecting starts.',
      'Do not pressure, bargain after a refusal or approach repeatedly through different channels. “No” is a complete answer.',
    ],
  },
  {
    id: 'what-to-offer',
    title: 'What to offer',
    summary: 'Make the benefit to the landowner concrete and easy to check.',
    paragraphs: [
      'A clear promise is stronger than a vague assurance. Offer a written record after each visit and show what the finished landowner report looks like.',
    ],
    points: [
      'A written record of finds and their locations, with sensitive details handled as agreed.',
      'A landowner report after each visit, including interesting objects even when they have little or no monetary value.',
      'Finds shown before removal when requested, and a written finds agreement before detecting.',
      'Adherence to the Code of Practice for Responsible Metal Detecting and all protected-site restrictions.',
      'Proof of suitable public liability insurance if held or requested.',
      'A written decision on non-Treasure finds, anything of value, PAS recording and the Treasure process.',
    ],
  },
  {
    id: 'the-agreement',
    title: 'The agreement',
    summary: 'Write down the practical terms before detecting begins.',
    paragraphs: [
      'The template below is a starting point for the parties to review and amend. It is not legal advice, and FindSpot does not draft contracts or decide who has authority to agree the terms.',
    ],
    points: [
      'Name the owner and occupier separately where they are different.',
      'Describe the land, permitted areas, duration, access times and notice required.',
      'Record crop, livestock, gate, vehicle, guest, ground-care and termination rules.',
      'Agree ownership of non-Treasure finds, value or sale decisions, Treasure procedure and PAS recording consent.',
      'Record insurance details and keep a copy available while detecting.',
    ],
  },
  {
    id: 'keeping-permission',
    title: 'Keeping it',
    summary: 'Reliability after the first yes earns the next invitation.',
    paragraphs: [
      'Send the promised report after every visit. Tell the landowner about an interesting object even when it is not valuable, and leave the land exactly as instructed.',
    ],
    points: [
      'Reinstate every hole and remove dug scrap.',
      'Report damage, an open gate, distressed livestock or another problem immediately.',
      'Check before every return visit; a previous yes is not permanent access.',
      'Ask before bringing a guest, changing fields, publishing a location or sharing identifiable photographs.',
    ],
  },
];

export const LAND_ACCESS_AGREEMENT_FILENAME = 'findspot-land-access-agreement-template.txt';

export const LAND_ACCESS_AGREEMENT_TEMPLATE = `FINDSPOT LAND ACCESS AGREEMENT — STARTING TEMPLATE

This editable template is a starting point for the parties to review and amend.
FindSpot does not provide legal advice, draft contracts or decide whether a person has authority to grant permission.

1. PARTIES
Landowner / freeholder: ______________________________________________
Address or contact: __________________________________________________

Occupier / tenant (if different): ____________________________________
Address or contact: __________________________________________________

Detectorist: _________________________________________________________
Address or contact: __________________________________________________

Each person signing should confirm their role and authority. Where owner and occupier differ, both positions should be agreed before detecting starts.

2. LAND AND DURATION
Land / farm: _________________________________________________________
Permitted fields or attached plan: ___________________________________
Excluded areas: ______________________________________________________
Permission starts: __________________  Ends / review date: ____________

3. ACCESS
Permitted days and times: ____________________________________________
Notice required before each visit: ___________________________________
Vehicle, parking and access route: ___________________________________
Guests: none unless agreed in writing / other: _______________________

4. GROUND, CROPS AND LIVESTOCK
The detectorist will follow all owner and occupier instructions, avoid standing crops and livestock unless expressly agreed, leave gates as found, minimise disturbance, fully reinstate holes, remove dug scrap and stop when conditions risk damage.
Additional requirements: _____________________________________________

5. FINDS AND REPORTING
When finds must be shown: ____________________________________________
Landowner report frequency: after each visit / other: _________________
Non-Treasure finds may be kept, returned or disposed of as follows:
______________________________________________________________________
Any value threshold, sale decision or division of proceeds:
______________________________________________________________________

6. ARCHAEOLOGICAL RECORDING AND PRIVACY
PAS / HER recording is: encouraged / permitted / discuss before recording
Location precision and confidentiality agreed: _______________________
The land name, precise location, maps and identifiable images will not be published or shared without prior consent, except where disclosure is legally required.

7. TREASURE
Potential Treasure must be reported through the applicable statutory process within 14 days of discovery or of first realising it may be Treasure. The detectorist will notify the owner and occupier promptly and will not sell, divide or dispose of a potential Treasure find while the process is unresolved.
Treasure reward understanding, subject to the statutory process:
______________________________________________________________________

8. INSURANCE
Provider / membership body: __________________________________________
Policy or member number: _____________________________________________
Expiry: ______________________________________________________________

9. VARIATION AND TERMINATION
Changes should be agreed in writing. The owner or occupier may stop access at any time. A refusal or withdrawal of permission is final and detecting must stop immediately.

SIGNED
Landowner / freeholder: __________________________  Date: _____________
Occupier / tenant: _______________________________  Date: _____________
Detectorist: _____________________________________  Date: _____________
`;
