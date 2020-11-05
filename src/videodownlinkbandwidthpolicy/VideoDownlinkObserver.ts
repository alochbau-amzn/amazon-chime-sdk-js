// Copyright 2020 Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

export default interface VideoDownlinkObserver {
  /**
   * Called when the downlink policy wants to change the remote videos being received
   */
  wantsResubscribe(): void;
}