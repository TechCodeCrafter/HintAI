# E2E audio fixtures

## `why-retry.wav`

Spoken question for the real audio-path test (16 kHz mono PCM, ~2 s speech + 5 s silence so looping fake mic can segment).

Regenerate on macOS:

```bash
say -v Samantha -o /tmp/q.aiff "Why does that retry three times?"
ffmpeg -y -i /tmp/q.aiff -af "apad=pad_dur=5" -ar 16000 -ac 1 why-retry.wav
```

## `silence-10s.wav`

Ten seconds of silence for the negative audio-path test:

```bash
ffmpeg -y -f lavfi -i anullsrc=r=16000:cl=mono -t 10 -sample_fmt s16 silence-10s.wav
```

## `noise-10s.wav`

~10 s of band-limited pink/brown noise (coffee-shop rumble) for the **expected-fail** noise-hallucination regression. Pass criteria = task 2 Silero gate wired.

```bash
ffmpeg -y -f lavfi -i "anoisesrc=d=10:c=pink:a=0.25" -f lavfi -i "anoisesrc=d=10:c=brown:a=0.15" \
  -filter_complex "[0:a][1:a]amix=inputs=2:duration=longest,volume=2.5,highpass=f=180,lowpass=f=3400,tremolo=f=3:d=0.35" \
  -ar 16000 -ac 1 -sample_fmt s16 noise-10s.wav
```
