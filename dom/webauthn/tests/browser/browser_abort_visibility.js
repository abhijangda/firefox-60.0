/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const TEST_URL = "https://example.com/browser/dom/webauthn/tests/browser/tab_webauthn_result.html";

async function assertStatus(tab, expected) {
  let actual = await ContentTask.spawn(tab.linkedBrowser, null, async function () {
    return content.document.getElementById("status").value;
  });
  is(actual, expected, "webauthn request " + expected);
}

async function waitForStatus(tab, expected) {
  await ContentTask.spawn(tab.linkedBrowser, [expected], async function (expected) {
    return ContentTaskUtils.waitForCondition(() => {
      return content.document.getElementById("status").value == expected;
    });
  });

  await assertStatus(tab, expected);
}

function startMakeCredentialRequest(tab) {
  return ContentTask.spawn(tab.linkedBrowser, null, async function () {
    const cose_alg_ECDSA_w_SHA256 = -7;

    let publicKey = {
      rp: {id: content.document.domain, name: "none", icon: "none"},
      user: {id: new Uint8Array(), name: "none", icon: "none", displayName: "none"},
      challenge: content.crypto.getRandomValues(new Uint8Array(16)),
      timeout: 5000, // the minimum timeout is actually 15 seconds
      pubKeyCredParams: [{type: "public-key", alg: cose_alg_ECDSA_w_SHA256}],
    };

    let status = content.document.getElementById("status");

    content.navigator.credentials.create({publicKey}).then(() => {
      status.value = "completed";
    }).catch(() => {
      status.value = "aborted";
    });

    status.value = "pending";
  });
}

function startGetAssertionRequest(tab) {
  return ContentTask.spawn(tab.linkedBrowser, null, async function () {
    let newCredential = {
      type: "public-key",
      id: content.crypto.getRandomValues(new Uint8Array(16)),
      transports: ["usb"],
    };

    let publicKey = {
      challenge: content.crypto.getRandomValues(new Uint8Array(16)),
      timeout: 5000, // the minimum timeout is actually 15 seconds
      rpId: content.document.domain,
      allowCredentials: [newCredential]
    };

    let status = content.document.getElementById("status");

    content.navigator.credentials.get({publicKey}).then(() => {
      status.value = "completed";
    }).catch(() => {
      status.value = "aborted";
    });

    status.value = "pending";
  });
}

add_task(async function test_setup() {
  await SpecialPowers.pushPrefEnv({
    "set": [
      ["security.webauth.webauthn", true],
      ["security.webauth.webauthn_enable_softtoken", false],
      ["security.webauth.webauthn_enable_usbtoken", true]
    ]
  });
});

// Test that MakeCredential() and GetAssertion() requests
// are aborted when the current tab loses its focus.
add_task(async function test_switch_tab() {
  // Create a new tab for the MakeCredential() request.
  let tab_create = await BrowserTestUtils.openNewForegroundTab(gBrowser, TEST_URL);

  // Start the request.
  await startMakeCredentialRequest(tab_create);
  await assertStatus(tab_create, "pending");

  // Open another tab and switch to it. The first will lose focus.
  let tab_get = await BrowserTestUtils.openNewForegroundTab(gBrowser, TEST_URL);
  await waitForStatus(tab_create, "aborted");

  // Start a GetAssertion() request in the second tab.
  await startGetAssertionRequest(tab_get);
  await assertStatus(tab_get, "pending");

  // Switch back to the first tab, the get() request is aborted.
  await BrowserTestUtils.switchTab(gBrowser, tab_create);
  await waitForStatus(tab_get, "aborted");

  // Close tabs.
  await BrowserTestUtils.removeTab(tab_create);
  await BrowserTestUtils.removeTab(tab_get);
});

add_task(async function test_new_window_make() {
  // Create a new tab for the MakeCredential() request.
  let tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, TEST_URL);

  // Start a MakeCredential request.
  await startMakeCredentialRequest(tab);
  await assertStatus(tab, "pending");

  // Open a new window. The tab will lose focus.
  let win = await BrowserTestUtils.openNewBrowserWindow();
  await waitForStatus(tab, "aborted");
  await BrowserTestUtils.closeWindow(win);

  // Close tab.
  await BrowserTestUtils.removeTab(tab);
});

add_task(async function test_new_window_get() {
  // Create a new tab for the GetAssertion() request.
  let tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, TEST_URL);

  // Start a GetAssertion request.
  await startGetAssertionRequest(tab);
  await assertStatus(tab, "pending");

  // Open a new window. The tab will lose focus.
  let win = await BrowserTestUtils.openNewBrowserWindow();
  await waitForStatus(tab, "aborted");
  await BrowserTestUtils.closeWindow(win);

  // Close tab.
  await BrowserTestUtils.removeTab(tab);
});

add_task(async function test_minimize_make() {
  let env = Cc["@mozilla.org/process/environment;1"]
              .getService(Ci.nsIEnvironment);
  // Minimizing windows doesn't supported in headless mode.
  if (env.get("MOZ_HEADLESS")) {
    return;
  }

  // Create a new tab for the MakeCredential() request.
  let tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, TEST_URL);

  // Start a MakeCredential request.
  await startMakeCredentialRequest(tab);
  await assertStatus(tab, "pending");

  // Minimize the window.
  window.minimize();
  await waitForStatus(tab, "aborted");

  // Restore the window.
  await new Promise(resolve => SimpleTest.waitForFocus(resolve, window));

  // Close tab.
  await BrowserTestUtils.removeTab(tab);
});

add_task(async function test_minimize_get() {
  let env = Cc["@mozilla.org/process/environment;1"]
              .getService(Ci.nsIEnvironment);
  // Minimizing windows doesn't supported in headless mode.
  if (env.get("MOZ_HEADLESS")) {
    return;
  }

  // Create a new tab for the GetAssertion() request.
  let tab = await BrowserTestUtils.openNewForegroundTab(gBrowser, TEST_URL);

  // Start a GetAssertion request.
  await startGetAssertionRequest(tab);
  await assertStatus(tab, "pending");

  // Minimize the window.
  window.minimize();
  await waitForStatus(tab, "aborted");

  // Restore the window.
  await new Promise(resolve => SimpleTest.waitForFocus(resolve, window));

  // Close tab.
  await BrowserTestUtils.removeTab(tab);
});
