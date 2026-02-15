import { world } from "./world.svelte";

export class TimelineState {
  playbackSpeed: number = $state(1.0);
  availableSpeeds: number[] = $state([0.5, 1, 2, 5, 10]);

  setSpeed(speed: number): void {
    this.playbackSpeed = speed;
    world.setSpeed(speed);
  }

  nextSpeed(): void {
    const idx = this.availableSpeeds.indexOf(this.playbackSpeed);
    const next = (idx + 1) % this.availableSpeeds.length;
    this.setSpeed(this.availableSpeeds[next]);
  }

  prevSpeed(): void {
    const idx = this.availableSpeeds.indexOf(this.playbackSpeed);
    if (idx > 0) {
      this.setSpeed(this.availableSpeeds[idx - 1]);
    }
  }
}

export const timeline = new TimelineState();
