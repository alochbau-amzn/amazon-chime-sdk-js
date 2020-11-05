// Copyright 2020 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

export default class VideoStreamPreference {
  /**
   * The attendee ID this preference relates to.
   */
  attendeeId: string;
  /**
   * The relative priority of this attendee against others
   */
  priority: number = 0;

  constructor(attendeeId: string, priority?: number) {
    this.attendeeId = attendeeId;
    this.priority = priority;
  }
}
