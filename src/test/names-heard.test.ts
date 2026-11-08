import { describe, expect, test } from 'bun:test';
import { namesHeard } from '../lib/names-heard';

// What the listener really heard in the first minute and a half of the previews on Teacher's Pet.
const ALADDIN =
  "is released for the first time ever. On Disney DVD. I think there's something written here, but it's hard to make out. Ten thousand years will give you such a crick in the neck. It's an exhilarating, fun-filled adventure with the hilarious characters you love, now in a spectacular first-ever digital presentation. The Aladdin Special Edition on Disney DVD. With bonus features fit for a Sultan. Absolutely marvelous experience a deleted song found in the Disney vault. Playing new games. Now I know I'm dreaming. So I'm a virtual magic carpet ride and go beyond the movie to uncover never-before-seen movie secrets. The Aladdin Special Edition to Disc DVD. Phenomenal Heartbeat Power. New DVD, let me explain. Coming October 5th, 2004.";
const MUSKETEERS =
  "All new on Disney DVD and video. Walt Disney Pictures proudly presents Mickey, Donald, and Goofy in an all new motion picture event. The Three Musketeers. I want Bobby Gart. Have I got to met for you? Oh, boy. Oh, if you think you can't do, get some dairy, yeah. You'll know that there's a must of you, you'll know this. Musketeers! It's all for one in one for all! All for one, hey! All for one in one for all!";
const LION_KING =
  "The Circle of Life continues as the legacy of the Lion King concludes in the Lion King 2 Simba's pride special edition We are part of each other one day I won't be here and I need you to carry on in my place My name is Cobra Two different worlds must unite these lands belong to Scars to save the pride lands. What is your destiny? I will avenge scars scar scar. Oh heck of a guy a little moody, but Featuring six origin";
const MULAN =
  "Every man from every family must serve in the Imperial Army. Father, you can't go. Mulan, you dishonor me. She was a girl who defied tradition to save her family's honor. The latest gift and honor is having you for a daughter. And now Mulan returns from the Disney Vault for the first time ever in a two-disc special edition DVD with remastered digital picture and sound and exclusive bonus features. Including activitie";
const DAVE =
  "Every weekend on Disney Channel, Dave the Barbarian. Meet Dave, he is the Barbarian. Please don't hurt me. And his two lovely sisters, Candy and Fang, the new spappy, his bed dragon. Together, they must guard the family castle. Will they be heroic? Will they fend off fiendish fiends? I'm the Master of Evil, the Master of Evil! Well, me. Dave the Barbarian every weekend at 53430 Central on Disney Channel.";

describe('the names said in real previews', () => {
  test('the Aladdin preview says its film', () => {
    expect(namesHeard(ALADDIN)).toContain('The Aladdin Special Edition');
  });

  test('the Three Musketeers preview says its film and who is in it', () => {
    expect(namesHeard(MUSKETEERS)).toEqual([
      'Walt Disney Pictures',
      'Mickey',
      'Donald',
      'Goofy',
      'The Three Musketeers',
      'Bobby Gart',
    ]);
  });

  test('the Lion King preview says its film, and the film before it is only a part of that', () => {
    const names = namesHeard(LION_KING);
    expect(names).toContain("Lion King 2 Simba's");
    expect(names).not.toContain('Lion King');
    expect(names).toContain('The Circle of Life');
  });

  test('the Mulan preview says Mulan once the sentence openers are left out', () => {
    expect(namesHeard(MULAN)).toEqual([
      'Imperial Army',
      'Mulan',
      'Disney Vault',
    ]);
  });

  test('the Dave the Barbarian promo says its show', () => {
    const names = namesHeard(DAVE);
    expect(names).toContain('Dave the Barbarian');
    expect(names).toContain('Disney Channel');
    expect(names).toContain('Candy and Fang');
    // "I'm the Master of Evil": the opener and the small word before the name are not part of it.
    expect(names).toContain('Master of Evil');
    expect(names).not.toContain('the Master of Evil');
  });

  test('nothing that is a name gives nothing', () => {
    expect(namesHeard('some rice cakes!')).toEqual([]);
    expect(namesHeard('')).toEqual([]);
  });
});

describe('what counts as a name', () => {
  test('a sentence opener is not a name, but a name at the start of a sentence is', () => {
    expect(
      namesHeard(
        'Now we go. Every day is good. Mulan, you dishonor me. Then Mulan ran.',
      ),
    ).toEqual(['Mulan']);
    expect(
      namesHeard('Every weekend on Disney Channel, Dave the Barbarian.'),
    ).toEqual(['Disney Channel', 'Dave the Barbarian']);
  });

  test('a lone word at the start of a sentence needs to be capitalized elsewhere too', () => {
    expect(namesHeard('Ten men came. Then Simba came.')).toEqual(['Simba']);
    expect(namesHeard('Simba ran. We saw Simba run.')).toEqual(['Simba']);
    expect(namesHeard('Simba ran.')).toEqual([]);
  });

  test('a run goes over "of", "the" and "and" between capitalized words, and over a number after a name', () => {
    expect(namesHeard('We read The Art of Gary Baseman today')).toEqual([
      'The Art of Gary Baseman',
    ]);
    expect(namesHeard('see Lord of the Rings, and Candy and Fang')).toEqual([
      'Lord of the Rings',
      'Candy and Fang',
    ]);
    expect(namesHeard('in the Lion King 2 Simba')).toEqual([
      'Lion King 2 Simba',
    ]);
  });

  test('other small words do not join two names, and a comma or a full stop ends a name', () => {
    expect(namesHeard('Walt Disney Pictures on Mickey Mouse')).toEqual([
      'Walt Disney Pictures',
      'Mickey Mouse',
    ]);
    expect(namesHeard('with Mickey, Donald, and Goofy. Daisy came')).toEqual([
      'Mickey',
      'Donald',
      'Goofy',
    ]);
  });

  test('months, weekdays and DVD are not names, and a number alone is not', () => {
    expect(namesHeard('on Friday in October 2004 on DVD')).toEqual([]);
    expect(namesHeard('see Disney DVD today')).toEqual(['Disney']);
    expect(namesHeard('We saw 53430 Central here')).toEqual(['Central']);
  });

  test('a name is listed once, and not again as a part of a longer one', () => {
    expect(namesHeard('see Mulan and then Mulan again')).toEqual(['Mulan']);
    expect(
      namesHeard('The Three Musketeers! Then Musketeers again, MUSKETEERS'),
    ).toEqual(['The Three Musketeers']);
  });

  test('a word of one or two letters is not a name', () => {
    expect(namesHeard('we met Al on TV today')).toEqual([]);
  });

  test('no more than eight are given', () => {
    const many = [
      'Alan',
      'Bert',
      'Carl',
      'Dave',
      'Earl',
      'Fred',
      'Glen',
      'Hank',
      'Ivan',
      'Jack',
    ];
    expect(namesHeard(`we met ${many.join(', ')} today`)).toEqual(
      many.slice(0, 8),
    );
  });
});
