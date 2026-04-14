import { useState } from "react";
import { audioEngine } from "../audio/AudioEngine";
import { Knob } from "./Knob";

interface Props {
  channel: number;
  color: string;
}

export function SoundFontKnobs({ channel, color }: Props) {
  const [volume, setVolume] = useState(80);
  const [pan, setPan] = useState(50);
  const [filterCut, setFilterCut] = useState(100);
  const [filterRes, setFilterRes] = useState(0);
  const [drive, setDrive] = useState(0);
  const [reverb, setReverb] = useState(0);
  const [delay, setDelay] = useState(0);

  return (
    <div className="flex items-center gap-1 px-3 py-1.5 border-b border-white/5 overflow-x-auto">
      <Knob
        value={volume}
        min={0}
        max={100}
        defaultValue={80}
        label="VOL"
        color={color}
        size={34}
        onChange={(v) => {
          setVolume(v);
          audioEngine.setChannelVolume(channel, v / 100);
        }}
      />
      <Knob
        value={pan}
        min={0}
        max={100}
        defaultValue={50}
        label="PAN"
        color={color}
        size={34}
        onChange={(v) => {
          setPan(v);
          audioEngine.setChannelPan(channel, (v - 50) / 50);
        }}
      />
      <Knob
        value={filterCut}
        min={0}
        max={100}
        defaultValue={100}
        label="CUT"
        color={color}
        size={34}
        onChange={(v) => {
          setFilterCut(v);
          if (v >= 99) {
            audioEngine.bypassChannelFilter(channel);
          } else {
            const freq = 80 * Math.pow(20000 / 80, v / 100);
            audioEngine.setChannelFilter(channel, "lowpass", freq, 1 + filterRes / 10);
          }
        }}
      />
      <Knob
        value={filterRes}
        min={0}
        max={100}
        defaultValue={0}
        label="RES"
        color={color}
        size={34}
        onChange={(v) => {
          setFilterRes(v);
          if (filterCut < 99) {
            const freq = 80 * Math.pow(20000 / 80, filterCut / 100);
            audioEngine.setChannelFilter(channel, "lowpass", freq, 1 + v / 10);
          }
        }}
      />
      <Knob
        value={drive}
        min={0}
        max={100}
        defaultValue={0}
        label="DRV"
        color={color}
        size={34}
        onChange={(v) => {
          setDrive(v);
          audioEngine.setChannelDrive(channel, v / 100);
        }}
      />
      <Knob
        value={reverb}
        min={0}
        max={100}
        defaultValue={0}
        label="REV"
        color={color}
        size={34}
        onChange={(v) => {
          setReverb(v);
          audioEngine.setChannelReverbSend(channel, v / 100);
        }}
      />
      <Knob
        value={delay}
        min={0}
        max={100}
        defaultValue={0}
        label="DLY"
        color={color}
        size={34}
        onChange={(v) => {
          setDelay(v);
          audioEngine.setChannelDelaySend(channel, v / 100);
        }}
      />
    </div>
  );
}
