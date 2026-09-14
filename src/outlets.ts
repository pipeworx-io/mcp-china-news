/**
 * The China / Hong Kong / Taiwan publisher inventory, exposed by
 * `china_news_outlets` and used to resolve the `region`, `lang` and `outlets`
 * arguments of `china_news_search`.
 *
 * Source of truth is `docs/data/china-news-inventory.json` in the Pipeworx
 * monorepo — a hand-audited census of 104 publishers (fleet #1390), where
 * `region` is the publisher's own jurisdiction and `language` is the language
 * its home edition publishes in. Kept here as a literal because a pack's
 * tsconfig rootDir is `src`, so `docs/` is out of bundle reach; re-sync by
 * hand if the inventory changes.
 *
 * `indexed` says whether GDELT's Global Knowledge Graph feed is filtered to
 * this publisher today — 28 of the 106 domains below. The other 78 are in the
 * census (they exist, they were probed) but no search here will ever return
 * them, and saying so is the entire point of exposing the inventory: coverage
 * you can check beats coverage you are asked to assume.
 */

export interface Outlet {
  publisher: string;
  /** The publisher's own home domain, as recorded in the census. */
  domain: string;
  region: 'cn' | 'hk' | 'tw' | 'overseas';
  /** Language of the publisher's HOME edition. See langOf() for the caveat. */
  language: 'zh' | 'en';
  access: string;
  /** Whether the GDELT GKG feed is filtered to this publisher today. */
  indexed: boolean;
}

export const REGIONS = ['cn', 'hk', 'tw', 'overseas'] as const;
export type Region = (typeof REGIONS)[number];

export const OUTLETS: Outlet[] = [
  { publisher: "10jqka (THS)", domain: "10jqka.com.cn", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "21st Century Business Herald", domain: "21jingji.com", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "36Kr", domain: "36kr.com", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "PLA Daily", domain: "81.cn", region: 'cn', language: 'zh', access: 'scrape', indexed: true },
  { publisher: "Beijing News", domain: "bjnews.com.cn", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Caijing", domain: "caijing.com.cn", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Caixin", domain: "caixin.com", region: 'cn', language: 'zh', access: 'scrape', indexed: true },
  { publisher: "China Business Journal", domain: "cb.com.cn", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Chengdu Business Daily", domain: "cdrb.com.cn", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Economic Daily", domain: "ce.cn", region: 'cn', language: 'zh', access: 'scrape', indexed: true },
  { publisher: "CGTN", domain: "cgtn.com", region: 'cn', language: 'en', access: 'native-rss', indexed: true },
  { publisher: "China Daily", domain: "chinadaily.com.cn", region: 'cn', language: 'en', access: 'scrape', indexed: true },
  { publisher: "China News Service", domain: "chinanews.com.cn", region: 'cn', language: 'zh', access: 'native-rss', indexed: true },
  { publisher: "Cailianshe (CLS)", domain: "cls.cn", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Shanghai Securities News (cnstock)", domain: "cnstock.com", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "China Securities Journal", domain: "cs.com.cn", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "China Youth Daily", domain: "cyol.com", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Dahe Daily (Henan)", domain: "dahe.cn", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Eastday (Shanghai)", domain: "eastday.com", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Eastmoney", domain: "eastmoney.com", region: 'cn', language: 'zh', access: 'gdelt-only', indexed: true },
  { publisher: "Economic Observer", domain: "eeo.com.cn", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Sina Finance", domain: "finance.sina.com.cn", region: 'cn', language: 'zh', access: 'gdelt-only', indexed: true },
  { publisher: "Global Times", domain: "globaltimes.cn", region: 'cn', language: 'en', access: 'scrape', indexed: true },
  { publisher: "Guangming Daily", domain: "gmw.cn", region: 'cn', language: 'zh', access: 'scrape', indexed: true },
  { publisher: "Guancha (The Observer)", domain: "guancha.cn", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "West China Metropolis Daily", domain: "huaxi100.com", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Huxiu", domain: "huxiu.com", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Straits Herald (Fujian)", domain: "hxnews.com", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Phoenix (ifeng)", domain: "ifeng.com", region: 'cn', language: 'zh', access: 'gdelt-only', indexed: true },
  { publisher: "Southern Weekly", domain: "infzm.com", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Jiefang Daily", domain: "jfdaily.com", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Jiemian News", domain: "jiemian.com", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "LatePost", domain: "latepost.com", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Legal Daily", domain: "legaldaily.com.cn", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "National Business Daily", domain: "nbd.com.cn", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "NetEase News", domain: "news.163.com", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Xinhua News Agency", domain: "news.cn", region: 'cn', language: 'zh', access: 'gdelt-only', indexed: true },
  { publisher: "Tencent News", domain: "news.qq.com", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Sina News", domain: "news.sina.com.cn", region: 'cn', language: 'zh', access: 'native-rss', indexed: true },
  { publisher: "Sohu News", domain: "news.sohu.com", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Southern Metropolis Daily", domain: "oeeee.com", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "People's Daily (people.cn / en.people.cn edition)", domain: "people.cn", region: 'cn', language: 'zh', access: 'gdelt-only', indexed: true },
  { publisher: "People's Daily", domain: "people.com.cn", region: 'cn', language: 'zh', access: 'native-rss', indexed: true },
  { publisher: "PingWest", domain: "pingwest.com", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Qiushi (Study Times)", domain: "qstheory.cn", region: 'cn', language: 'zh', access: 'scrape', indexed: true },
  { publisher: "Sichuan Daily", domain: "scdaily.cn", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Southern Daily (Nanfang)", domain: "southcn.com", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Securities Times (STCN)", domain: "stcn.com", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Science and Technology Daily", domain: "stdaily.com", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "TechNode", domain: "technode.com", region: 'cn', language: 'en', access: 'native-rss', indexed: true },
  { publisher: "The Paper (Pengpai)", domain: "thepaper.cn", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Wall Street CN", domain: "wallstreetcn.com", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Wenhui Daily", domain: "whb.cn", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Modern Express", domain: "xdkb.net", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Xinhua News Agency (xinhuanet.com edition)", domain: "xinhuanet.com", region: 'cn', language: 'zh', access: 'gdelt-only', indexed: true },
  { publisher: "Xinmin Evening News", domain: "xinmin.cn", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Yangtze Evening News (Jiangsu)", domain: "yangtse.com", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Yicai", domain: "yicai.com", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Beijing Youth Daily (ynet)", domain: "ynet.com", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Qianjiang Evening News (Zhejiang)", domain: "zjol.com.cn", region: 'cn', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "am730", domain: "am730.com.hk", region: 'hk', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Bastille Post", domain: "bastillepost.com", region: 'hk', language: 'zh', access: 'native-rss', indexed: false },
  { publisher: "HK01", domain: "hk01.com", region: 'hk', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Hong Kong Free Press", domain: "hongkongfp.com", region: 'hk', language: 'en', access: 'native-rss', indexed: false },
  { publisher: "InMedia HK", domain: "inmediahk.net", region: 'hk', language: 'zh', access: 'native-rss', indexed: false },
  { publisher: "Ming Pao", domain: "mingpao.com", region: 'hk', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Now News", domain: "news.now.com", region: 'hk', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "TVB News", domain: "news.tvb.com", region: 'hk', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Oriental Daily News", domain: "orientaldaily.on.cc", region: 'hk', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "RTHK", domain: "rthk.hk", region: 'hk', language: 'zh', access: 'native-rss', indexed: false },
  { publisher: "South China Morning Post", domain: "scmp.com", region: 'hk', language: 'en', access: 'native-rss', indexed: true },
  { publisher: "Sing Tao Daily (HK)", domain: "singtao.com", region: 'hk', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Ta Kung Pao", domain: "takungpao.com", region: 'hk', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "The Standard (HK)", domain: "thestandard.com.hk", region: 'hk', language: 'en', access: 'scrape', indexed: true },
  { publisher: "Wen Wei Po", domain: "wenweipo.com", region: 'hk', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Aboluowang", domain: "aboluowang.com", region: 'overseas', language: 'zh', access: 'gdelt-only', indexed: true },
  { publisher: "BBC Chinese", domain: "bbc.com", region: 'overseas', language: 'zh', access: 'native-rss', indexed: true },
  { publisher: "Boxun", domain: "boxun.com", region: 'overseas', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "China Digital Times", domain: "chinadigitaltimes.net", region: 'overseas', language: 'en', access: 'native-rss', indexed: false },
  { publisher: "Deutsche Welle Chinese", domain: "dw.com", region: 'overseas', language: 'zh', access: 'native-rss', indexed: true },
  { publisher: "Duowei News", domain: "dwnews.com", region: 'overseas', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Epoch Times (Chinese)", domain: "epochtimes.com", region: 'overseas', language: 'zh', access: 'gdelt-only', indexed: true },
  { publisher: "Ming Pao Canada", domain: "mingpaocanada.com", region: 'overseas', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "NTD (New Tang Dynasty)", domain: "ntdtv.com", region: 'overseas', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Radio Free Asia Mandarin", domain: "rfa.org", region: 'overseas', language: 'zh', access: 'native-rss', indexed: true },
  { publisher: "Secret China", domain: "secretchina.com", region: 'overseas', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Sound of Hope", domain: "soundofhope.org", region: 'overseas', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Initium Media", domain: "theinitium.com", region: 'overseas', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Voice of America Chinese", domain: "voachinese.com", region: 'overseas', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "World Journal", domain: "worldjournal.com", region: 'overseas', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "China Times", domain: "chinatimes.com", region: 'tw', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "CNA (Central News Agency)", domain: "cna.com.tw", region: 'tw', language: 'zh', access: 'gdelt-only', indexed: true },
  { publisher: "ETtoday", domain: "ettoday.net", region: 'tw', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Liberty Times", domain: "ltn.com.tw", region: 'tw', language: 'zh', access: 'native-rss', indexed: true },
  { publisher: "Mirror Media", domain: "mirrormedia.mg", region: 'tw', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Yam News", domain: "n.yam.com", region: 'tw', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "PTS News", domain: "news.pts.org.tw", region: 'tw', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "TVBS News", domain: "news.tvbs.com.tw", region: 'tw', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Newtalk", domain: "newtalk.tw", region: 'tw', language: 'zh', access: 'native-rss', indexed: false },
  { publisher: "NOWnews", domain: "nownews.com", region: 'tw', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Radio Taiwan International (RTI)", domain: "rti.org.tw", region: 'tw', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "SETN", domain: "setn.com", region: 'tw', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "Storm Media", domain: "storm.mg", region: 'tw', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "The News Lens", domain: "thenewslens.com", region: 'tw', language: 'zh', access: 'scrape', indexed: false },
  { publisher: "United Daily News (UDN)", domain: "udn.com", region: 'tw', language: 'zh', access: 'native-rss', indexed: true },
  { publisher: "Up Media", domain: "upmedia.mg", region: 'tw', language: 'zh', access: 'scrape', indexed: false },];

/** The 28 publishers whose articles can actually be searched. */
export const INDEXED_OUTLETS: Outlet[] = OUTLETS.filter((o) => o.indexed);

/**
 * GDELT records the SERVING HOST, not the publisher's home domain, so a row
 * for Xinhua arrives as `english.news.cn` and one for Guangming Daily as
 * `en.gmw.cn`. Match a host to its publisher the same way the ingest does —
 * exact, or a dot-delimited suffix, never a substring, so `theepochtimes.com`
 * cannot be mistaken for `epochtimes.com`.
 */
export function outletForHost(host: string): Outlet | undefined {
  const h = host.toLowerCase().trim();
  return INDEXED_OUTLETS.find((o) => h === o.domain || h.endsWith(`.${o.domain}`));
}

/**
 * Which language a given SERVING HOST publishes in — deliberately not the same
 * question as `Outlet.language`, and conflating them is the mirror image of
 * the region/language trap recorded in docs/china-news-plan.md sec 9.
 *
 * Measured against the live store on 2026-09-11: every host present was an
 * English one, and four of them (english.news.cn, en.people.cn, en.gmw.cn,
 * en.ce.cn) belong to publishers whose census language is `zh`, because GDELT
 * indexes the English editions of the mainland state outlets far more heavily
 * than the Chinese ones. Filtering on the publisher's language alone would
 * therefore have answered `lang: "zh"` with 166 English-language articles.
 * The host prefix is the evidence that is actually on the row, so it wins.
 */
export function langOf(host: string, outlet: Outlet | undefined): 'zh' | 'en' {
  const h = host.toLowerCase().trim();
  if (h.startsWith('english.') || h.startsWith('en.') || h.includes('.en.')) return 'en';
  return outlet?.language ?? 'zh';
}
