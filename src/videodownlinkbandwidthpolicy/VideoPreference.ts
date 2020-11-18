// Copyright 2020 Amazon.com, Inc. or its affiliates. All Rights Reserved.
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
   * The maximum simulcast layers to receive.
   */
  maxSize: SimulcastLayers = SimulcastLayers.High;

  constructor(attendeeId: string, priority: number, maxSize?: SimulcastLayers) {
    this.attendeeId = attendeeId;
    this.priority = priority;
    if (!!maxSize) {
      this.maxSize = maxSize;
    }
  }
}
