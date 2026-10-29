// Synthetic, deterministic test data. Contains no real journal content.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function isoLocal(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const STRESSORS = ['اجتماع عمل متأخر', 'ازدحام الطريق', 'نقاش مع أحد الأقارب', 'موعد تسليم قريب', ''];
const THOUGHTS = ['يجب أن أنجز كل شيء اليوم', 'سيكون الاجتماع كارثة', 'أنا فاشل في هذا', '', 'كل مرة يحدث نفس الشيء'];
const TAGS = ['#قلق', '#شغل', '#عائلة', '#نوم_سيء', '#إنجاز', '#امتنان', '#توتر', '#عزلة'];

export function makeDataset({ days = 40, seed = 7, gapEvery = 6, endOffset = 0 } = {}) {
  const r = rng(seed);
  const logs = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    if (gapEvery && i % gapEvery === 3) continue; // missing days on purpose
    const d = new Date(today);
    d.setDate(d.getDate() - i - endOffset);
    const sleep = r() < 0.15 ? null : Math.round((4.5 + r() * 4.5) * 2) / 2;
    // mood loosely follows sleep so the correlation is non-trivial
    const base = sleep == null ? 5 : 2 + (sleep - 4.5) * 1.1;
    const mood = Math.max(1, Math.min(10, Math.round(base + (r() * 3 - 1.5))));
    const tags = TAGS.filter(() => r() < 0.22);
    if (sleep != null && sleep < 6 && !tags.includes('#نوم_سيء')) tags.push('#نوم_سيء');
    const stressor = STRESSORS[Math.floor(r() * STRESSORS.length)];
    logs.push({
      date: isoLocal(d), mood, sleep,
      ev1: 'حدث تجريبي', ev2: '', ev3: '',
      stressor, stressLevel: stressor ? 3 + Math.floor(r() * 7) : 5,
      intrusive: THOUGHTS[Math.floor(r() * THOUGHTS.length)],
      gratitude: r() < 0.4 ? 'كوب شاي هادئ' : '',
      tags, ts: d.getTime() + 20 * 3600e3,
    });
  }
  const dayAgo = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return isoLocal(d); };
  const scHist = [
    { type: 'phq', score: 12, max: 27, date: dayAgo(35), ts: 1 },
    { type: 'gad', score: 11, max: 21, date: dayAgo(34), ts: 2 },
    { type: 'phq', score: 9, max: 27, date: dayAgo(14), ts: 3 },
    { type: 'gad', score: 8, max: 21, date: dayAgo(13), ts: 4 },
    { type: 'phq', score: 7, max: 27, date: dayAgo(1), ts: 5 },
  ];
  const sessions = [
    { type: 'done-cbt', dur: 14, date: dayAgo(20), ts: 10, ans: { situation: 'اجتماع', hotThought: 'سيكون الاجتماع كارثة', hotBeliefPre: 80, hotBeliefPost: 45, alternative: 'قد يكون صعباً لكن يمكنني التحضير' } },
    { type: 'done-ba', dur: 9, date: dayAgo(12), ts: 11, ans: { chosenActivity: 'المشي 10 دقائق', expectedPleasure: 3, actualPleasure: 6, moodPre: 4, moodPost: 6, didActivity: 'نعم أكملته' } },
    { type: 'done-ba', dur: 7, date: dayAgo(5), ts: 12, ans: { chosenActivity: 'الاتصال بصديق', expectedPleasure: 2, actualPleasure: 5, moodPre: 4, moodPost: 5, didActivity: 'نعم أكملته' } },
    { type: 'done-ea', dur: 8, date: dayAgo(3), ts: 13, ans: { targetEmotion: 'القلق', intensityPre: 7, intensityPost: 5, avoidance: ['التشتيت بالهاتف', 'طلب طمأنة الآخرين'] } },
  ];
  const actL = [
    { name: 'المشي', exp: 3, act: 6, date: dayAgo(10), ts: 20 },
    { name: 'قراءة', exp: 4, act: 5, date: dayAgo(6), ts: 21 },
  ];
  const breathL = [{ date: dayAgo(4), dur: 76, cycles: 4, ts: 30 }];
  const profile = { age: '30', gender: '', status: '', goals: 'القلق، النوم', medical: '', phqBaseline: '12', gadBaseline: '11' };
  return { logs, scHist, sessions, actL, breathL, profile, cbtE: [], customSc: [] };
}

export function seedScript(data, pin = '1234') {
  const entries = Object.entries(data).map(([k, v]) => [`nl_${k}`, JSON.stringify(v)]);
  entries.push(['nl_pin', JSON.stringify(pin)]);
  return entries;
}
