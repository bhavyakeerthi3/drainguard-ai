export const DRAIN_CONFIDENCE_THRESHOLD = 60;
export const SAME_DRAIN_THRESHOLD = 68;

/** @param {number} confidence */
export function isDrainConfirmed(confidence) {
  return confidence >= DRAIN_CONFIDENCE_THRESHOLD;
}

/**
 * @param {{ sameDrain: boolean, drainConfidence: number, blockage: number, litter: number, reduction: number }} evidence
 */
export function passesCleanupVerification(evidence) {
  return evidence.sameDrain
    && isDrainConfirmed(evidence.drainConfidence)
    && evidence.blockage <= 48
    && evidence.litter <= 48
    && evidence.reduction >= 15;
}
