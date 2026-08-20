import type { HolidayType } from '../schema.js';

export interface NameMatch {
  key: string;
  name_en: string;
  type: HolidayType;
  /** False when no rule matched and the result is a fallback. */
  matched: boolean;
}

interface NameRule {
  key: string;
  name_en: string;
  type: HolidayType;
  pattern: RegExp;
}

/**
 * Ordered — the first match wins. Order is load-bearing in three places:
 *
 *  1. `ชดเชย` must precede every observance, because substitution names embed the
 *     observance they compensate ("วันหยุดชดเชยวันวิสาขบูชา").
 *  2. The Queen Mother (12 Aug) must precede Queen Suthida (3 Jun): the Queen
 *     Mother's full title contains "พระบรมราชินีนาถ", which also matches "พระบรมราชินี".
 *  3. King Bhumibol's memorial day (13 Oct) must precede his birthday (5 Dec): both
 *     full titles contain "ภูมิพล".
 */
const RULES: NameRule[] = [
  { key: 'substitution_holiday', name_en: 'Substitution Holiday', type: 'substitution', pattern: /ชดเชย/ },
  { key: 'special_cabinet_holiday', name_en: 'Special Cabinet Holiday', type: 'special_cabinet', pattern: /หยุดพิเศษ|กรณีพิเศษ|ครม/ },

  { key: 'new_year_day', name_en: "New Year's Day", type: 'public', pattern: /ขึ้นปีใหม่|ขื้นปีใหม่/ },
  { key: 'new_year_eve', name_en: "New Year's Eve", type: 'public', pattern: /สิ้นปี/ },
  { key: 'makha_bucha', name_en: 'Makha Bucha Day', type: 'public', pattern: /มาฆบูชา/ },
  { key: 'chakri_day', name_en: 'Chakri Memorial Day', type: 'public', pattern: /จักรี/ },
  { key: 'songkran', name_en: 'Songkran Festival', type: 'public', pattern: /สงกรานต์/ },
  { key: 'labour_day', name_en: 'National Labour Day', type: 'public', pattern: /แรงงาน/ },
  { key: 'coronation_day', name_en: 'Coronation Day', type: 'public', pattern: /ฉัตรมงคล/ },
  { key: 'royal_ploughing_day', name_en: 'Royal Ploughing Ceremony Day', type: 'royal', pattern: /พืชมงคล/ },
  { key: 'visakha_bucha', name_en: 'Visakha Bucha Day', type: 'public', pattern: /วิสาขบูชา/ },
  { key: 'asarnha_bucha', name_en: 'Asarnha Bucha Day', type: 'public', pattern: /อาสาฬหบูชา|อาสฬหบูชา/ },
  { key: 'khao_phansa', name_en: 'Buddhist Lent Day', type: 'public', pattern: /เข้าพรรษา/ },
  // One-off days off that ครม. granted in a particular year rather than annually.
  { key: 'chinese_new_year', name_en: 'Chinese New Year', type: 'special_cabinet', pattern: /ตรุษจีน/ },
  { key: 'mahidol_day', name_en: 'Mahidol Day', type: 'special_cabinet', pattern: /มหิดล/ },
  { key: 'coronation_ceremony', name_en: 'Royal Coronation Ceremony', type: 'special_cabinet', pattern: /บรมราชาภิเษก/ },
  { key: 'royal_cremation', name_en: 'Royal Cremation Ceremony', type: 'special_cabinet', pattern: /ถวายพระเพลิง|พระราชพิธีถวาย/ },

  { key: 'queen_mother_birthday', name_en: "HM Queen Sirikit The Queen Mother's Birthday", type: 'public', pattern: /วันแม่|สิริกิ|พันปีหลวง/ },
  { key: 'king_bhumibol_memorial_day', name_en: 'HM King Bhumibol Adulyadej Memorial Day', type: 'public', pattern: /นวมินทรมหาราช|สวรรคต/ },
  { key: 'king_vajiralongkorn_birthday', name_en: "HM King Vajiralongkorn's Birthday", type: 'public', pattern: /วชิรเกล้า|วชิราลงกรณ/ },
  { key: 'queen_suthida_birthday', name_en: "HM Queen Suthida's Birthday", type: 'public', pattern: /สุทิดา|พระบรมราชินี/ },
  { key: 'chulalongkorn_day', name_en: 'Chulalongkorn Day', type: 'public', pattern: /ปิยมหาราช/ },
  { key: 'king_bhumibol_birthday', name_en: "HM King Bhumibol Adulyadej's Birthday (National Father's Day)", type: 'public', pattern: /วันพ่อ|ชนกาธิเบศร|ราชสมภพ|ภูมิพล/ },
  { key: 'constitution_day', name_en: 'Constitution Day', type: 'public', pattern: /รัฐธรรมนูญ/ },
];

/** Collapse whitespace and strip zero-width characters Google's feed injects. */
export function normaliseThai(name: string): string {
  return name.replace(/[​-‏﻿]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Resolve a Thai holiday name to a stable key, English name and type.
 * Unrecognised names fall back to `key: 'unknown'` with `matched: false` so callers
 * can raise a warning instead of silently publishing a mislabelled day.
 */
export function resolveName(nameTh: string): NameMatch {
  const name = normaliseThai(nameTh);
  for (const rule of RULES) {
    if (rule.pattern.test(name)) {
      return { key: rule.key, name_en: rule.name_en, type: rule.type, matched: true };
    }
  }
  return { key: 'unknown', name_en: name, type: 'public', matched: false };
}
