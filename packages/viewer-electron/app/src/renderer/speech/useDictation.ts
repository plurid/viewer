import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../domain/errors';
import type { SpeechProcessing, SpeechTranscript } from '../../domain/speech/recognition';
import { captureAudio, type AudioCapture } from './capture';

type Phase = 'idle' | 'preparing' | 'listening' | 'transcribing' | 'review' | 'failed';
interface Recording {
  id: string;
  controller: AbortController;
  audio?: AudioCapture;
}
export function useDictation() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [result, setResult] = useState<SpeechTranscript>();
  const [processing, setProcessing] = useState<SpeechProcessing>();
  const recording = useRef<Recording | undefined>(undefined);
  const cancel = useCallback(() => {
    const current = recording.current;
    recording.current = undefined;
    if (current) {
      current.controller.abort();
      current.audio?.cancel();
      void window.viewer.speech({ kind: 'cancel', id: current.id }).catch(() => {});
    }
  }, []);
  const fail = useCallback(
    (message: string) => {
      cancel();
      setError(message);
      setPhase('failed');
    },
    [cancel],
  );
  const finish = useCallback(async () => {
    const current = recording.current;
    if (!current) return;
    if (!current.audio) {
      cancel();
      setPhase('idle');
      return;
    }
    const audio = current.audio;
    current.audio = undefined;
    setPhase('transcribing');
    try {
      const pcm = await audio.finish();
      current.controller.signal.throwIfAborted();
      const answer = await window.viewer.speech({ kind: 'transcribe', id: current.id, pcm });
      if (recording.current !== current) return;
      if (!answer || !('text' in answer))
        throw new Error('The speech engine did not return a transcript.');
      recording.current = undefined;
      setResult(answer);
      setText(answer.text);
      setPhase('review');
      setLevel(0);
    } catch (error) {
      if (recording.current === current) fail(errorMessage(error));
    }
  }, [cancel, fail]);
  const finishRef = useRef(finish);
  finishRef.current = finish;
  const start = useCallback(async () => {
    if (recording.current) return;
    const current: Recording = { id: crypto.randomUUID(), controller: new AbortController() };
    recording.current = current;
    setError('');
    setText('');
    setResult(undefined);
    setSeconds(0);
    setLevel(0);
    setPhase('preparing');
    setProcessing(undefined);
    try {
      const started = await window.viewer.speech({ kind: 'begin', id: current.id });
      current.controller.signal.throwIfAborted();
      if (!started || !('id' in started) || !('preferences' in started))
        throw new Error('The recording did not start. Try again.');
      setProcessing(started.processing ?? { kind: 'local' });
      if (!document.hasFocus()) throw new Error('Return to Viewer and start recording again.');
      current.audio = await captureAudio({
        microphone: started.preferences.microphone,
        signal: current.controller.signal,
        progress: (seconds, level) => {
          if (recording.current === current) {
            setSeconds(seconds);
            setLevel(level);
          }
        },
        limit: () => void finishRef.current(),
        failed: fail,
      });
      if (recording.current !== current) {
        current.audio.cancel();
        return;
      }
      setPhase('listening');
    } catch (error) {
      if (recording.current === current) fail(errorMessage(error));
    }
  }, [fail]);
  useEffect(() => {
    const stop = window.viewer.onEvent((event) => {
      if (event.type !== 'speech' || event.event.id !== recording.current?.id) return;
      if (event.event.state === 'cancelled' || event.event.state === 'failed')
        fail(event.event.message ?? 'Recording stopped. Start again when you are ready.');
    });
    const blur = () => {
      if (recording.current?.audio)
        fail('Recording stopped when Viewer lost focus. Start again when you are ready.');
    };
    window.addEventListener('blur', blur);
    return () => {
      stop();
      window.removeEventListener('blur', blur);
      cancel();
    };
  }, [cancel, fail]);
  return { phase, error, text, setText, seconds, level, result, processing, start, finish, cancel };
}
