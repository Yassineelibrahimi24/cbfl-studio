import { MOODS, type MoodId } from '../theory/compose';

export function Beginner({
  mood,
  setMood,
  ready,
  voice,
  onMake,
  onRhythm,
  onBass,
  onSimpler,
  onVoice,
  onRecord,
  onAdvanced,
}: {
  mood: MoodId;
  setMood: (mood: MoodId) => void;
  ready: boolean;
  voice: boolean;
  onMake: () => void;
  onRhythm: () => void;
  onBass: () => void;
  onSimpler: () => void;
  onVoice: () => void;
  onRecord: () => void;
  onAdvanced: () => void;
}) {
  return (
    <section className="beginner">
      <div className="beginner-card">
        <h1>Make a beat</h1>
        <p className="lead">Pick a feeling. We write the rhythm, the low notes, the chords, and the tune, already in time. You do not need to know where each part goes.</p>
        <div className="moods">
          {MOODS.map((item) => (
            <button key={item.id} type="button" className={mood === item.id ? 'mood on' : 'mood'} onClick={() => setMood(item.id)}>
              <strong>{item.label}</strong>
              <span>{item.blurb}</span>
            </button>
          ))}
        </div>
        <button className="btn play big" type="button" onClick={onMake}>Make a beat</button>
        {ready ? (
          <div className="tweaks">
            <p>This beat is already together. Change one thing, or leave it and press Play.</p>
            <div className="tweak-row">
              <button className="btn" type="button" onClick={onRhythm}>Change the rhythm</button>
              <button className="btn" type="button" onClick={onBass}>Make the low notes follow</button>
              <button className="btn" type="button" onClick={onSimpler}>Simpler tune</button>
              <button className="btn" type="button" onClick={onVoice}>Add my voice</button>
            </div>
          </div>
        ) : null}
        {voice ? (
          <div className="voice-box">
            <p>Press Record and hum or talk over the beat. Press Stop at the top when you are done. Your voice sits on top. It does not replace the beat.</p>
            <button className="btn stop" type="button" onClick={onRecord}>Record</button>
          </div>
        ) : null}
        <ul className="roles">
          <li><b>Rhythm</b> is the part you nod to.</li>
          <li><b>Low notes</b> sit under the kick.</li>
          <li><b>Chords</b> are the bed of the song.</li>
          <li><b>Tune</b> is the part you could hum.</li>
        </ul>
        <button className="linkish" type="button" onClick={onAdvanced}>Full studio</button>
      </div>
    </section>
  );
}
