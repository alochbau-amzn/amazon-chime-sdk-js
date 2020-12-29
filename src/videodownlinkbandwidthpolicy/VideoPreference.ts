// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import SimulcastLayers from '../simulcastlayers/SimulcastLayers';

export default class VideoStreamPreference {
  /**
   * The attendee ID this preference relates to.
   */
  attendeeId: string;

  /**
   * The relative priority of this attendee against others.
   */
  priority: number;

  /**
   * The desired maximum simulcast layers to receive.
   */
  desiredMaxSize: SimulcastLayers = SimulcastLayers.High;

  constructor(attendeeId: string, priority: number, maxSize?: SimulcastLayers) {
    this.attendeeId = attendeeId;
    this.priority = priority;
    if (!!maxSize) {
      this.desiredMaxSize = maxSize;
    }
  }
}
