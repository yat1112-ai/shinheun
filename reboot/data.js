// CH1 승인 초안 콘텐츠. 모든 밸런스 수치는 임시이며 최종 기획값이 아니다.
// 브라우저 ES module 및 Node ES module에서 사용하는 순수 데이터 모듈.
export const BALANCE_NOTES = {
  status: 'approved-draft',
  qaHandoff: [
    '스테이지 적·웨이브·보상·대사는 승인된 서사 기반 초안이다.',
    '능력치, 배율, 재사용, 지속시간, 생산량, 비용, 경험치와 합류 스테이지는 테스트용 임시값이다.',
    '라운드는 모든 기본 행동 기회 한 순환이다. 효과는 적용 라운드 이후부터 남은 라운드를 차감한다.',
    '재사용은 사용 후 해당 캐릭터의 다음 행동 기회부터 차감한다. 웨이브 교체는 부활 사용 횟수를 초기화하지 않는다.',
    '온라인 반복은 실제 전투이며 오프라인 파견과 분리한다. 데이터만으로 보상 중복 방지나 저장 안전성을 보장하지 않는다.',
    '온라인 생산·파견 시간 정책은 온라인 경과시간을 그대로 적립하는 초안이다. 오프라인은 둘을 같은 최대 12시간 창으로 계산한다.',
    '아티팩트 및 후속 시스템은 예약 식별자만 있으며 효과나 구현을 제공하지 않는다.',
  ],
};

export const GAME_CONFIG = {
  chapter: 1, maxPartySize: 5, initialParty: ['eir'], protagonist: 'jin',
  saveKey: 'shinheun.ch1.draft', saveVersion: 1, port: 8877,
  startingResources: { gold: 0, herbs: 0, ore: 0 },
  equipmentSlots: ['weapon', 'armor', 'gloves', 'boots'],
  reservedEquipmentSlots: ['accessory', 'artifact'],
  level: { initial: 1, max: 30, experiencePerLevel: 50, experienceGrowth: 25,
    statGrowth: { hp: 12, atk: 2, defense: 1 } },
  watchBlessing: { name: '회중시계의 가호', atk: 2, hp: 10, description: '아버지가 맡긴 회중시계에서 전해지는 작은 가호.' },
  codex: { killThreshold: 100, claimReward: { sharedAtk: 1 }, countOnFinalVictoryOnly: true },
};

export const SKILLS = {
  eirHeal: { id: 'eirHeal', name: '기도의 물결', type: 'heal', target: 'lowestHpAlly', cooldown: 2,
    healAtkRatio: 1.8, effects: [{ type: 'regen', healAtkRatio: 0.4, durationRounds: 2 }],
    ai: { missingHpRatioAtLeast: 0.25 }, animation: 'prayer' },
  eirGroupHeal: { id: 'eirGroupHeal', name: '따뜻한 기도', type: 'heal', target: 'allAllies', cooldown: 4,
    healAtkRatio: 1.2, ai: { injuredAlliesAtLeast: 2, missingHpRatioAtLeast: 0.2 }, animation: 'prayer' },
  eirRevive: { id: 'eirRevive', name: '이어지는 기도', type: 'passive', trigger: 'allyDeath',
    target: 'otherAlly', requiresOwnerAlive: true, usesPerBattle: 1, restoredHpRatio: 0.2,
    resetOnWave: false },
  arenBreak: { id: 'arenBreak', name: '무거운 일격', type: 'attack', target: 'singleEnemy', cooldown: 2,
    damageType: 'physical', atkRatio: 1.8, effects: [{ type: 'defenseDown', ratio: 0.25, durationRounds: 2 }], animation: 'heavySword' },
  arenBuff: { id: 'arenBuff', name: '결의의 검', type: 'attack', target: 'singleEnemy', cooldown: 3,
    damageType: 'physical', atkRatio: 1.4, selfEffects: [{ type: 'atkUp', ratio: 0.25, durationRounds: 2 }], animation: 'heavySword' },
  arenFocus: { id: 'arenFocus', name: '집중', type: 'passive', trigger: 'sameTargetAttack',
    damageBonusPerStack: 0.1, maxStacks: 3, resetOnTargetChange: true },
  rianaFlurry: { id: 'rianaFlurry', name: '쌍검 난무', type: 'attack', target: 'distributedEnemies', cooldown: 3,
    damageType: 'physical', hits: 6, atkRatioPerHit: 0.45, distribution: 'balanced',
    singleEnemyReceivesAllHits: true, redistributeOnDeath: true, animation: 'dualBlades' },
  rianaMark: { id: 'rianaMark', name: '사냥의 표식', type: 'attack', target: 'singleEnemy', cooldown: 2,
    damageType: 'physical', atkRatio: 1.2, effects: [{ type: 'physicalVulnerability', ratio: 0.2, durationRounds: 2 }], animation: 'dualBlades' },
  rianaFollowup: { id: 'rianaFollowup', name: '빠른 추격', type: 'passive', trigger: 'ownerKill',
    target: 'singleEnemy', damageType: 'physical', atkRatio: 0.7, maxExtraHitsPerAction: 1, canChain: false },
  cleaTaunt: { id: 'cleaTaunt', name: '방패의 선언', type: 'attack', target: 'singleEnemy', cooldown: 3,
    damageType: 'physical', atkRatio: 1.1,
    enemyEffects: [{ type: 'taunt', target: 'allEnemies', durationRounds: 2, respectsImmunity: true }],
    selfEffects: [{ type: 'physicalDamageReduction', ratio: 0.5, durationRounds: 2 }],
    tauntChangesSingleTargetOnly: true, animation: 'shield' },
  cleaShield: { id: 'cleaShield', name: '함께 버티는 방패', type: 'shield', target: 'allAllies', cooldown: 4,
    shieldOwnerMaxHpRatio: 0.15, durationRounds: 2, animation: 'shield' },
  cleaSupport: { id: 'cleaSupport', name: '보호 보조 (임시)', type: 'passive', trigger: 'battleStart',
    target: 'allAllies', shieldOwnerMaxHpRatio: 0.05, durationRounds: 1, draft: true },
};

// 일반공격 데이터. atkRatio 1은 엔진의 기존 기본 공격 배율과 동일하다(수치 변경 없음).
export const BASIC_ATTACKS = {
  eirBasic: { id: 'eirBasic', name: '일반공격', type: 'basic', target: 'singleEnemy', damageType: 'physical', atkRatio: 1, animation: 'prayer' },
  arenBasic: { id: 'arenBasic', name: '일반공격', type: 'basic', target: 'singleEnemy', damageType: 'physical', atkRatio: 1, animation: 'heavySword' },
  rianaBasic: { id: 'rianaBasic', name: '일반공격', type: 'basic', target: 'singleEnemy', damageType: 'physical', atkRatio: 1, animation: 'dualBlades' },
  cleaBasic: { id: 'cleaBasic', name: '일반공격', type: 'basic', target: 'singleEnemy', damageType: 'physical', atkRatio: 1, animation: 'shield' },
};

export const CHARACTERS = {
  eir: { id: 'eir', name: '에이르', role: 'healer', playable: true, initialLevel: 1,
    stats: { hp: 150, atk: 22, defense: 8, speed: 10 }, basicAttack: 'eirBasic', skills: ['eirHeal', 'eirGroupHeal'], passive: 'eirRevive',
    aiPriority: ['eirGroupHeal', 'eirHeal', 'basicAttack'], motion: 'prayer', join: { type: 'initial' } },
  aren: { id: 'aren', name: '아렌', role: 'striker', playable: true, initialLevel: 1,
    stats: { hp: 190, atk: 32, defense: 12, speed: 9 }, basicAttack: 'arenBasic', skills: ['arenBreak', 'arenBuff'], passive: 'arenFocus',
    aiPriority: ['arenBreak', 'arenBuff', 'basicAttack'], motion: 'heavySword', join: { type: 'stageVictory', stageId: 1 } },
  riana: { id: 'riana', name: '리아나', role: 'rogue', playable: true, initialLevel: 1,
    stats: { hp: 155, atk: 27, defense: 8, speed: 15 }, basicAttack: 'rianaBasic', skills: ['rianaFlurry', 'rianaMark'], passive: 'rianaFollowup',
    aiPriority: ['rianaFlurry', 'rianaMark', 'basicAttack'], motion: 'dualBlades', join: { type: 'stageFirstEntry', stageId: 5 } },
  clea: { id: 'clea', name: '클레아', role: 'guardian', playable: true, initialLevel: 1,
    stats: { hp: 270, atk: 20, defense: 18, speed: 7 }, basicAttack: 'cleaBasic', skills: ['cleaTaunt', 'cleaShield'], passive: 'cleaSupport',
    aiPriority: ['cleaShield', 'cleaTaunt', 'basicAttack'], motion: 'shield', join: { type: 'stageFirstEntry', stageId: 5 } },
};
export const STORY_CHARACTERS = {
  jin: { id: 'jin', name: '진', playable: false, description: '어머니를 기다리며 회중시계를 품고 길을 나선다.' },
  mother: { id: 'mother', name: '어머니', playable: false, canFightInStory: true },
};

export const ENEMIES = {
  stray: { id: 'stray', name: '길 잃은 작은 짐승', stats: { hp: 55, atk: 10, defense: 2, speed: 8 }, damageType: 'physical' },
  wolf: { id: 'wolf', name: '숲 늑대', stats: { hp: 100, atk: 16, defense: 4, speed: 12 }, damageType: 'physical' },
  boar: { id: 'boar', name: '숲멧돼지', stats: { hp: 160, atk: 20, defense: 8, speed: 7 }, damageType: 'physical' },
  ragingBoar: { id: 'ragingBoar', name: '폭주 숲멧돼지', stats: { hp: 550, atk: 32, defense: 12, speed: 8 }, damageType: 'physical',
    immunities: ['taunt'], skills: [{ name: '거친 돌진', target: 'allAllies', atkRatio: 0.8, cooldown: 3, damageType: 'physical' }] },
};

const line = (speaker, text) => ({ speaker, text });
const wave = (...enemyIds) => ({ enemies: enemyIds.map(enemyId => ({ enemyId, level: 1 })) });
const stage = (id, name, waves, story, gold, xp, materials = {}, extra = {}) => ({
  id, chapter: 1, name, unlockAfterStage: id === 1 ? null : id - 1,
  firstEntryOnly: true, story, waves, entryCost: { gold: 0 },
  rewards: { gold, xp, materials }, firstClearRewards: { gold: gold * 2 }, ...extra,
});
export const STAGES = [
  stage(1, '성당 앞의 소란', [wave('stray')], [
    line('jin', '어머니가 아직 돌아오지 않았어. 성당에 들르면 소식을 알 수 있을까?'),
    line('eir', '진, 네 아버지가 맡긴 회중시계야. 잘 간직해.'),
    line('jin', '시계가 조금 따뜻해진 것 같아… 저 소리는 뭐지?'),
    line('eir', '짐승들이 마을로 들어왔어. 내 뒤에 있어!'),
  ], 20, 30, { herbs: 1 }, { victoryStory: [line('aren', '마을 밖도 소란스럽다. 내가 함께 갈게.')], recruitOnVictory: ['aren'] }),
  stage(2, '마을 밖 오솔길', [wave('stray', 'stray')], [
    line('aren', '흔적이 숲으로 이어진다. 어머니도 이 길로 가셨겠지?'), line('jin', '응. 우리도 따라가 보자.'),
  ], 25, 35, { herbs: 1 }),
  stage(3, '뒤엉킨 발자국', [wave('wolf'), wave('stray', 'wolf')], [
    line('eir', '짐승들이 평소와 달라. 다친 사람부터 찾아야 해.'), line('aren', '길은 내가 열겠다.'),
  ], 30, 40, { herbs: 2 }),
  stage(4, '숲 입구의 부름', [wave('wolf', 'wolf')], [
    line('jin', '저쪽에서 어머니 목소리가 들려!'), line('eir', '서두르되 떨어지지 말자.'),
  ], 35, 45, { herbs: 2 }),
  stage(5, '뜻밖의 조우', [wave('boar', 'wolf')], [
    line('riana', '위험해요! 저희가 도와드릴게요!'), line('clea', '제 방패 뒤로 오세요.'),
    line('mother', '고맙구나. 하지만 나도 싸울 수 있단다. 진, 여기까지 왔니?'),
    line('jin', '걱정돼서 왔어. 같이 돌아가자.'), line('mother', '먼저 저 짐승들을 진정시켜야겠구나.'),
  ], 45, 55, { herbs: 2, ore: 1 }, { recruitOnFirstEntry: ['riana', 'clea'] }),
  stage(6, '숲의 거친 숨결', [wave('wolf', 'boar'), wave('boar', 'boar')], [
    line('riana', '큰 멧돼지가 지나갔어요. 다른 짐승들도 쫓겨 나온 것 같아요.'), line('aren', '더 가까이 오기 전에 막자.'),
  ], 50, 60, { ore: 2 }),
  stage(7, '부러진 나무 사이', [wave('wolf', 'wolf', 'boar')], [
    line('clea', '나무가 이렇게 부러지다니… 모두 제 뒤에서 움직여요.'), line('eir', '다치면 바로 말해. 기도가 닿을 거야.'),
  ], 55, 65, { herbs: 2, ore: 2 }),
  stage(8, '폭주의 흔적', [wave('boar', 'boar'), wave('wolf', 'boar', 'wolf')], [
    line('mother', '저 앞의 멧돼지는 보통 상태가 아니야. 조심해야 한다.'), line('jin', '시계는 잘 가지고 있어. 모두 무사히 돌아가자.'),
  ], 60, 70, { ore: 3 }),
  stage(9, '폭주 숲멧돼지', [wave('ragingBoar')], [
    line('riana', '왔어요! 양옆에서 빈틈을 찾을게요.'), line('clea', '돌진은 모두에게 닿아요. 방패로 함께 버텨요!'),
    line('aren', '내가 끝까지 붙잡겠다.'),
  ], 80, 90, { herbs: 3, ore: 3 }),
  stage(10, '돌아가는 길', [wave('wolf', 'boar'), wave('ragingBoar', 'wolf')], [
    line('mother', '아직 길목에 남은 짐승들이 있구나. 마지막으로 길을 열자.'), line('jin', '이 길 끝에서 다 같이 마을로 돌아가자.'),
  ], 100, 110, { ore: 4 }, { victoryStory: [
    line('eir', '이제 마을에서 쉬자. 모두 수고했어.'),
    line('mother', '광산 쪽에도 문제가 있다는 소식을 들었어. 다음에는 그곳을 살펴봐야겠구나.'),
  ], unlockOnVictory: ['dispatch'] }),
];

const equipment = (id, name, slot, stats, price) => ({ id, name, slot, stats, price, currency: 'gold', draft: true });
export const EQUIPMENT = {
  prayerStaff: equipment('prayerStaff', '기도의 지팡이', 'weapon', { atk: 4 }, 30),
  singleSword: equipment('singleSword', '튼튼한 단일검', 'weapon', { atk: 6 }, 40),
  dualBlades: equipment('dualBlades', '가벼운 쌍검', 'weapon', { atk: 5 }, 40),
  shieldMace: equipment('shieldMace', '수호자의 무기', 'weapon', { atk: 3, defense: 2 }, 40),
  clothArmor: equipment('clothArmor', '여행 방어구', 'armor', { hp: 20, defense: 3 }, 30),
  leatherGloves: equipment('leatherGloves', '가죽 장갑', 'gloves', { atk: 2 }, 20),
  walkingBoots: equipment('walkingBoots', '여행 신발', 'boots', { hp: 10, speed: 1 }, 20),
};
export const INITIAL_EQUIPMENT = {
  eir: { weapon: 'prayerStaff', armor: null, gloves: null, boots: null },
  aren: { weapon: 'singleSword', armor: null, gloves: null, boots: null },
  riana: { weapon: 'dualBlades', armor: null, gloves: null, boots: null },
  clea: { weapon: 'shieldMace', armor: null, gloves: null, boots: null },
};
export const PRODUCTION = [
  { id: 'herbGarden', name: '약초 돌보기', intervalSeconds: 300, reward: { herbs: 1 }, draft: true },
  { id: 'villageSupplies', name: '마을 물자 정리', intervalSeconds: 600, reward: { gold: 5 }, draft: true },
];
export const ACTIVITY_RULES = {
  onlineRepeat: { slots: 1, clearedDestinationsOnly: true, mode: 'actualCombat',
    availableDuring: ['village', 'characters', 'inventory'], cancelUnfinishedOnDisconnect: true,
    refundUnfinishedEntryCost: true, retainCompletedRewards: true, resumeRequiresProposal: true,
    equipmentSnapshot: 'battleStart', speedAffectsRewards: false },
  dispatch: { slots: 1, unlockAfterStage: 10, clearedDestinationsOnly: true,
    allowCombatPartyMembers: true, rewardRatio: 0.5, rounding: 'floorPerResource',
    baseDurationSeconds: 600, minimumDurationSeconds: 60,
    powerFormula: 'sum(hp / 10 + atk * 2 + defense)',
    durationFormula: 'max(minimumDurationSeconds, ceil(baseDurationSeconds * 100 / max(1, power)))',
    increasesCodex: false, includeFirstClearRewards: false, includeRecruitment: false },
  accrual: { offlineMaxSeconds: 43200, offlineWindowSharedBy: ['production', 'dispatch'],
    onlinePolicy: 'elapsedTime', claim: 'batch', preserveOnPopupClose: true, duplicateClaimAllowed: false },
};
export const RESERVED_CONTENT = { equipmentSlots: ['accessory', 'artifact'], extraPartySlots: 1 };

// 캐릭터 스킬 구조: 일반공격 1 + 액티브 2 + 패시브 1 (참조만 해석하며 수치는 각 데이터가 보유).
export function getSkillKit(characterId) {
  const c = CHARACTERS[characterId];
  if (!c) return null;
  return { basicAttack: BASIC_ATTACKS[c.basicAttack], actives: c.skills.map(id => SKILLS[id]), passive: SKILLS[c.passive] };
}

export default { BALANCE_NOTES, GAME_CONFIG, SKILLS, BASIC_ATTACKS, CHARACTERS, STORY_CHARACTERS,
  ENEMIES, STAGES, EQUIPMENT, INITIAL_EQUIPMENT, PRODUCTION, ACTIVITY_RULES, RESERVED_CONTENT };
