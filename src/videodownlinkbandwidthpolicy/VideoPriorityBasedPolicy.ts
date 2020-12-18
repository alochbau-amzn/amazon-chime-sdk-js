// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { Maybe } from '..';
import Logger from '../logger/Logger';
import VideoAdaptivePolicy from './VideoAdaptivePolicy';
import VideoPreference from './VideoPreference';

export default class VideoPriorityBasedPolicy extends VideoAdaptivePolicy {
  constructor(protected logger: Logger) {
    super(logger);
    this.videoPreferences = [];
    this.pauseTiles = true;
  }

  reset(): void {
    super.reset();
    this.pauseTiles = true;
  }

  chooseRemoteVideoSources(preferences: VideoPreference[]): void {
    if (this.isPreferencesDifferent(preferences)) {
      this.videoPreferences = preferences;
      this.videoPreferencesUpdated = true;
      this.logger.info(`bwe: new preferences: ${JSON.stringify(this.videoPreferences)}`);
      if (this.wantsResubscribe()) {
        this.logger.info(`videoPriorityBasedPolicy wants a resubscribe`);
        this.forEachObserver(observer => {
          Maybe.of(observer.wantsResubscribe).map(f => f.bind(observer)());
        });
      }
    }
  }

  private isPreferencesDifferent(preferences: VideoPreference[]): boolean {
    if (preferences.length !== this.videoPreferences.length) {
      return true;
    }

    for (const preference of preferences) {
      if (
        this.videoPreferences.findIndex(
          videoPreference =>
            videoPreference.attendeeId === preference.attendeeId &&
            videoPreference.priority === preference.priority
        ) === -1
      ) {
        return true;
      }
    }
    return false;
  }
}
