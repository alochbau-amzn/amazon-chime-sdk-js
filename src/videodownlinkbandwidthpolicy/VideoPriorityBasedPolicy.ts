// Copyright 2020 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import VideoAdaptivePolicy from './VideoAdaptivePolicy';
import VideoPreference from './VideoPreference';

export default class VideoPriorityBasedPolicy extends VideoAdaptivePolicy {
  setRemoteSourcePriority(preferences: VideoPreference[]): void {
    this.videoPreferences = preferences;
    this.videoPreferencesUpdated = true;
    if (this.wantsResubscribe()) {
      this.logger.info(`videoPriorityBasedPolicy wants a resubscribe`);
    }
  }
}
