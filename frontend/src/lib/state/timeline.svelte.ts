import { world } from "./world.svelte";

export class TimelineState {
  playbackSpeed: number = $state(1.0);
  availableSpeeds: number[] = $state([0.5, 1, 2, 5, 10]);

  setSpeed(speed: number): void {
    this.playbackSpeed = speed;
    world.setSpeed(speed);
  }

  nextSpeed(): void {
    let idx = this.availableSpeeds.indexOf(this.playbackSpeed);
    if (idx === -1) idx = this.findClosestSpeedIndex();
    const next = (idx + 1) % this.availableSpeeds.length;
    this.setSpeed(this.availableSpeeds[next]);
  }

  prevSpeed(): void {
    let idx = this.availableSpeeds.indexOf(this.playbackSpeed);
    if (idx === -1) idx = this.findClosestSpeedIndex();
    if (idx > 0) {
      this.setSpeed(this.availableSpeeds[idx - 1]);
    }
  }

  private findClosestSpeedIndex(): number {
    let best = 0;
    let bestDist = Math.abs(this.availableSpeeds[0] - this.playbackSpeed);
    for (let i = 1; i < this.availableSpeeds.length; i++) {
      const dist = Math.abs(this.availableSpeeds[i] - this.playbackSpeed);
      if (dist < bestDist) {
        best = i;
        bestDist = dist;
      }
    }
    return best;
  }
}

export const timeline = new TimelineState();
