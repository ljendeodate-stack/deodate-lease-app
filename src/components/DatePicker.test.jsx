// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DatePicker from './DatePicker.jsx';

const cleanups = [];

function setViewport(width, height) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: height,
  });
}

function mockAnchorRect(anchor, rect) {
  Object.defineProperty(anchor, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      toJSON: () => rect,
    }),
  });
}

async function renderDatePicker(props = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);

  await act(async () => {
    root.render(<DatePicker value="" onChange={() => {}} {...props} />);
  });

  cleanups.push(async () => {
    await act(async () => {
      root.unmount();
    });
    host.remove();
  });

  return {
    host,
    anchor: host.firstElementChild,
    toggle: host.querySelector('button[aria-label="Toggle calendar"]'),
  };
}

async function click(element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function mouseDown(element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
}

async function keyDown(key) {
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    await cleanup();
  }
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('DatePicker', () => {
  it('renders the calendar popup in a portal and selects a date', async () => {
    setViewport(1280, 900);
    const onChange = vi.fn();
    const { host, anchor, toggle } = await renderDatePicker({
      value: '04/10/2026',
      onChange,
    });
    mockAnchorRect(anchor, {
      left: 48,
      right: 248,
      top: 120,
      bottom: 164,
      width: 200,
      height: 44,
    });

    await click(toggle);

    const popup = document.body.querySelector('[data-datepicker-popup="true"]');
    expect(popup).not.toBeNull();
    expect(host.querySelector('[data-datepicker-popup="true"]')).toBeNull();
    expect(popup?.getAttribute('data-placement')).toBe('bottom');

    const dayButton = Array.from(popup.querySelectorAll('button')).find((button) => button.textContent === '15');
    expect(dayButton).toBeTruthy();

    await click(dayButton);

    expect(onChange).toHaveBeenCalledWith('04/15/2026');
    expect(document.body.querySelector('[data-datepicker-popup="true"]')).toBeNull();
  });

  it('closes on Escape and outside clicks', async () => {
    setViewport(1280, 900);
    const { anchor, toggle } = await renderDatePicker({
      value: '04/10/2026',
      onChange: vi.fn(),
    });
    mockAnchorRect(anchor, {
      left: 60,
      right: 220,
      top: 140,
      bottom: 184,
      width: 160,
      height: 44,
    });

    await click(toggle);
    expect(document.body.querySelector('[data-datepicker-popup="true"]')).not.toBeNull();

    await keyDown('Escape');
    expect(document.body.querySelector('[data-datepicker-popup="true"]')).toBeNull();

    await click(toggle);
    expect(document.body.querySelector('[data-datepicker-popup="true"]')).not.toBeNull();

    await mouseDown(document.body);
    expect(document.body.querySelector('[data-datepicker-popup="true"]')).toBeNull();
  });

  it('flips above the field when opened near the bottom of the viewport', async () => {
    setViewport(1280, 760);
    const { anchor, toggle } = await renderDatePicker({
      value: '04/10/2026',
      onChange: vi.fn(),
    });
    mockAnchorRect(anchor, {
      left: 84,
      right: 244,
      top: 700,
      bottom: 744,
      width: 160,
      height: 44,
    });

    await click(toggle);

    const popup = document.body.querySelector('[data-datepicker-popup="true"]');
    expect(popup).not.toBeNull();
    expect(popup?.getAttribute('data-placement')).toBe('top');
  });
});
