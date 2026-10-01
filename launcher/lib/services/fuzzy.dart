/// Fuzzy matching, and the scoring behind it.
///

/// Where a query matched inside a name, for highlighting.
class MatchRange {
  const MatchRange(this.start, this.end);

  final int start;

  /// Exclusive.
  final int end;

  @override
  String toString() => 'MatchRange($start, $end)';
}

/// One scored result.
class FuzzyHit {
  const FuzzyHit(this.score, this.ranges);

  final int score;

  /// Which characters of the *name* were matched, for the highlight. Not the
  /// haystack — the haystack is a concatenation, and highlighting inside it
  /// would light up the wrong glyphs.
  final List<MatchRange> ranges;
}

/// Matches [query] against [text] and returns a scored hit, or null.
///
/// Subsequence matching, because that is what makes a launcher feel fast: you
/// type "chr" and Chrome is there, without having typed a prefix that matches
/// anything. The scoring is what makes it feel *right*, and it is worth being
/// deliberate about, because the order of results is the entire product.
///
/// What is rewarded, in descending order of weight:
///
///   1. A match at the start of a word. "g" in "GitHub" and "Go" both hit a
///      word start; "g" in "Angular" does not, and should rank far below.
///   2. Consecutive characters. "ch" matching "Ch"rome as a pair is much
///      stronger than the same two letters matched across a gap.
///   3. An exact substring, which is a special case of 2.
///   4. Shorter targets. Given equal match quality, "Go" should beat
///      "Google Chrome" for the query "go" — you were probably not typing the
///      longer one's name.
///
/// What is deliberately not rewarded: matches in the comment or the keyword
/// list. They make an app *findable*, which is the point, but they must not
/// outrank a real name match — so they are matched against the haystack for
/// inclusion and the name for scoring.
FuzzyHit? fuzzyMatch(String query, String text) {
  if (query.isEmpty) return const FuzzyHit(0, []);
  if (text.isEmpty) return null;

  final q = query.toLowerCase();
  final t = text.toLowerCase();

  // Fast path: a plain substring hit is both the most common case and the
  // strongest signal, and it gets its range without walking the DP.
  final direct = t.indexOf(q);
  if (direct != -1) {
    return FuzzyHit(
      1000 + _wordStartBonus(t, direct) + (text.length - q.length),
      [MatchRange(direct, direct + q.length)],
    );
  }

  // Subsequence walk. Greedy from the left, which is not optimal in general but
  // is optimal for the cases that matter here and is O(n) rather than O(n*m).
  var qi = 0;
  var score = 0;
  var lastHit = -2;
  final ranges = <MatchRange>[];
  var runStart = -1;

  for (var ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] != q[qi]) continue;

    // Word-start bonus: previous char is a separator, or this is index 0.
    final atWordStart = ti == 0 || _isSeparator(t[ti - 1]);
    if (atWordStart) score += 60;

    // Consecutive bonus.
    if (ti == lastHit + 1) {
      score += 40;
      // Extend the open run rather than starting a new range, so the highlight
      // is one contiguous block.
      if (runStart != -1 && ranges.isNotEmpty) {
        final last = ranges.removeLast();
        ranges.add(MatchRange(last.start, ti + 1));
      }
    } else {
      if (runStart != -1) {}
      ranges.add(MatchRange(ti, ti + 1));
      runStart = ti;
    }

    // A small penalty for the distance travelled, so that among equally good
    // matches the tighter one wins.
    score -= (ti - qi).clamp(0, 20);

    lastHit = ti;
    qi++;
  }

  if (qi < q.length) return null; // not a subsequence

  // Prefer shorter names, weakly.
  score += (80 - text.length).clamp(0, 80);

  return FuzzyHit(score, ranges);
}

bool _isSeparator(String c) =>
    c == ' ' || c == '-' || c == '_' || c == '.' || c == '/' || c == ':';

int _wordStartBonus(String t, int at) =>
    at == 0 || _isSeparator(t[at - 1]) ? 60 : 0;
