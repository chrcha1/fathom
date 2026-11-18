// What kind of thing a topic is, read from Wikipedia's one-line description
// ("American politician (born 1971)", "2026 Indian film by Nitesh Tiwari").
// Decides which lens a current word shows up under and which questions the
// reading view suggests. Pure.

export const LENSES = ['anything', 'news', 'people', 'tech', 'culture'];

const PERSON =
  /\((?:born|died)\b[^)]*\)|\(\d{3,4}\s*[–-]\s*\d{3,4}\)|\b(?:politician|actor|actress|singer|rapper|musician|songwriter|footballer|cricketer|(?:basketball|football|tennis|baseball|hockey|rugby|soccer) player|racing driver|golfer|boxer|wrestler|athlete|swimmer|businessman|businesswoman|entrepreneur|comedian|filmmaker|film director|journalist|novelist|poet|writer|author|scientist|physicist|chemist|biologist|economist|mathematician|lawyer|activist|diplomat|youtuber|streamer|president of|prime minister of|king of|queen of|senator|head of the catholic church)\b/i;

const WORK =
  /\b(?:film|movie|television series|tv series|miniseries|web series|drama series|animated series|sitcom|anime|manga|album|mixtape|song|single by|novel|book|video game|musical|opera|play by|painting|sculpture|podcast|documentary|soundtrack|comic|franchise|poem|concert tour|reality show|talk show|game show|pay-per-view)\b/i;

const ARTIST =
  /\b(?:actor|actress|singer|rapper|musician|songwriter|band|comedian|filmmaker|film director|novelist|poet|painter|photographer|artist|dancer|playwright)\b/i;

const EVENT =
  /\b(?:election|referendum|war|conflict|insurgency|invasion|attack|shooting|bombing|massacre|earthquake|hurricane|cyclone|typhoon|storm|windstorm|flood|wildfire|crisis|protests?|riots?|coup|battle|siege|disaster|crash|collision|explosion|pandemic|epidemic|outbreak|scandal|trial|summit|tournament|championship|world cup|olympics|grand prix|season|ceremony|strike|impeachment|negotiations|meetings)\b/i;

const PLACE =
  /^(?:[\w.-]+ ){0,3}(?:country|city|town|village|state|province|district|county|capital|region|municipality|island|borough|commune|territory|continent|prefecture|emirate|metropolis)(?: (?:in|of|on|and)\b|$)/i;

const ORGANISATION =
  /\b(?:company|corporation|firm|organi[sz]ation|political party|party|agency|university|college|institution|institute|club|team|government|ministry|court|bank|army|navy|air force|armed forces|police|militia|militant group|group|committee|council|union|alliance|broadcaster|newspaper|magazine|network|airline|manufacturer|retailer|conglomerate|foundation|charity|parliament|legislature|cabinet|senate)\b/i;

const TECH =
  /\b(?:technolog(?:y|ies)|software|hardware|comput(?:er|ing|ation)s?|artificial intelligence|machine learning|neural network|language model|chatbot|semiconductors?|microprocessor|processor|chip|spacecraft|rocket|satellite|space (?:mission|telescope|station|probe|agency)|telescope|programming language|operating system|internet|web browser|search engine|algorithm|cryptograph\w*|cryptocurrency|blockchain|cybersecurity|robot\w*|drone|quantum|physics|chemistry|biology|genetic\w*|genom\w*|astronom\w*|astrophysic\w*|mathematic\w*|engineering|scientific|science|medical|medicine|medication|drug|vaccine|virus|disease|protein|particle|reactor|nuclear|battery|electric vehicle|smartphone|social media|data cent(?:er|re)|encryption|open-source|protocol|database)\b/i;

const test = (pattern, text) => typeof text === 'string' && pattern.test(text);
const sameCategory = (category, name) => typeof category === 'string' && category.toLowerCase() === name;

export const isPerson = (description) => test(PERSON, description);
export const isPlace = (description) => !isPerson(description) && test(PLACE, description);

// One of: person, work, event, place, organisation, technology, idea.
export function subjectKind({ description = null, title = '' } = {}) {
  if (test(PERSON, description)) return 'person';
  if (test(WORK, description)) return 'work';
  if (/^\d{4}(?:[–-]\d{2,4})?\s/.test(title) || test(EVENT, description)) return 'event';
  if (test(PLACE, description)) return 'place';
  if (test(ORGANISATION, description)) return 'organisation';
  if (test(TECH, description)) return 'technology';
  return 'idea';
}

// Whether a current word belongs under a lens. `item.origin` is where it came
// from ('portal' and 'news' are reported events, 'mostread' is reading
// figures) and `item.category` is the current-events section it sat in.
export function inLens(item, lens) {
  const { description, category, origin } = item;
  switch (lens) {
    case 'anything':
      return true;
    case 'news':
      return origin === 'portal' || origin === 'news';
    case 'people':
      return isPerson(description);
    case 'tech':
      return sameCategory(category, 'science and technology') || test(TECH, description);
    case 'culture':
      return sameCategory(category, 'arts and culture') || test(WORK, description) || test(ARTIST, description);
    default:
      return false;
  }
}
