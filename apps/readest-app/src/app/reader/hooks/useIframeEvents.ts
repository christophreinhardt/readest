import { useEffect, useRef } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useDeviceControlStore } from '@/store/deviceStore';
import { useReaderStore } from '@/store/readerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { debounce } from '@/utils/debounce';
import { ScrollSource } from './usePagination';
import { eventDispatcher } from '@/utils/event';
import { MAX_ZOOM_LEVEL, MIN_ZOOM_LEVEL } from '@/services/constants';

export const useMouseEvent = (
  bookKey: string,
  handlePageFlip: (msg: MessageEvent | React.MouseEvent<HTMLDivElement, MouseEvent>) => void,
  handleContinuousScroll: (source: ScrollSource, delta: number, threshold: number) => void,
) => {
  const { hoveredBookKey } = useReaderStore();
  const debounceScroll = debounce(handleContinuousScroll, 500);
  const debounceFlip = debounce(handlePageFlip, 100);
  const handleMouseEvent = (msg: MessageEvent | React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    if (msg instanceof MessageEvent) {
      if (msg.data && msg.data.bookKey === bookKey) {
        if (msg.data.type === 'iframe-wheel') {
          debounceScroll('mouse', -msg.data.deltaY, 0);
        }
        if (msg.data.type === 'iframe-wheel') {
          if (msg.data.ctrlKey) {
            if (msg.data.deltaY > 0) {
              eventDispatcher.dispatch('zoom-out', { factor: Math.abs(msg.data.deltaY) / 100 });
            } else if (msg.data.deltaY < 0) {
              eventDispatcher.dispatch('zoom-in', { factor: Math.abs(msg.data.deltaY) / 100 });
            }
          } else {
            debounceFlip(msg);
          }
        } else {
          handlePageFlip(msg);
        }
      }
    } else if (msg.type === 'wheel') {
      const event = msg as React.WheelEvent<HTMLDivElement>;
      debounceScroll('mouse', -event.deltaY, 0);
    } else {
      handlePageFlip(msg);
    }
  };

  useEffect(() => {
    window.addEventListener('message', handleMouseEvent);
    return () => {
      window.removeEventListener('message', handleMouseEvent);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey, hoveredBookKey]);

  return {
    onClick: handlePageFlip,
    onWheel: handleMouseEvent,
  };
};

export const useLongPressEvent = (
  bookKey: string,
  handleImagePress: (src: string) => void,
  handleTablePress: (html: string) => void,
) => {
  const handleLongPress = (msg: MessageEvent) => {
    if (msg.data && msg.data.bookKey === bookKey && msg.data.type === 'iframe-long-press') {
      if (msg.data.elementType === 'image') {
        handleImagePress(msg.data.src);
      } else if (msg.data.elementType === 'table') {
        handleTablePress(msg.data.html);
      }
    }
  };

  useEffect(() => {
    window.addEventListener('message', handleLongPress);
    return () => {
      window.removeEventListener('message', handleLongPress);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey]);
};

interface IframeTouch {
  clientX: number;
  clientY: number;
  screenX: number;
  screenY: number;
}

interface IframeTouchEvent {
  timeStamp: number;
  targetTouches: IframeTouch[];
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const GESTURE_ACTIVATION_THRESHOLD = 24;
const GESTURE_FULL_RANGE_HEIGHT_FACTOR = 0.35;

export const useTouchEvent = (
  bookKey: string,
  handlePageFlip: (msg: CustomEvent) => void,
  handleContinuousScroll: (source: ScrollSource, delta: number, threshold: number) => void,
) => {
  const { envConfig, appService } = useEnv();
  const { getBookData } = useBookDataStore();
  const { hoveredBookKey, setHoveredBookKey, getViewSettings, getView } = useReaderStore();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const { setScreenBrightness } = useDeviceControlStore();

  const touchStartRef = useRef<IframeTouch | null>(null);
  const touchEndRef = useRef<IframeTouch | null>(null);
  const touchStartTimeRef = useRef<number | null>(null);
  const touchEndTimeRef = useRef<number | null>(null);
  const isPinchingRef = useRef(false);
  const initialPinchDistRef = useRef(0);
  const initialZoomRef = useRef(100);
  const lastPinchRatioRef = useRef(1);
  const settingsRef = useRef(settings);
  const pendingSettingsSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const brightnessGestureRef = useRef<{ initialValue: number; active: boolean } | null>(null);
  const colorTemperatureGestureRef = useRef<{
    initialValue: number;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);

  settingsRef.current = settings;

  const scheduleSettingsSave = (nextSettings: typeof settings) => {
    if (pendingSettingsSaveRef.current) {
      clearTimeout(pendingSettingsSaveRef.current);
    }
    pendingSettingsSaveRef.current = setTimeout(() => {
      saveSettings(envConfig, nextSettings);
    }, 150);
  };

  const applyBrightnessGestureValue = (brightness: number) => {
    const nextBrightness = clamp(Math.round(brightness), 0, 100);
    const currentSettings = settingsRef.current;
    if (
      currentSettings.screenBrightness === nextBrightness &&
      currentSettings.autoScreenBrightness === false
    ) {
      return;
    }
    const nextSettings = {
      ...currentSettings,
      screenBrightness: nextBrightness,
      autoScreenBrightness: false,
    };
    settingsRef.current = nextSettings;
    setSettings(nextSettings);
    scheduleSettingsSave(nextSettings);
    void setScreenBrightness(nextBrightness / 100);
  };

  const applyColorTemperatureGestureValue = (temperature: number) => {
    const nextTemperature = clamp(Math.round(temperature), -100, 100);
    const currentSettings = settingsRef.current;
    if (currentSettings.screenColorTemperature === nextTemperature) {
      return;
    }
    const nextSettings = { ...currentSettings, screenColorTemperature: nextTemperature };
    settingsRef.current = nextSettings;
    setSettings(nextSettings);
    scheduleSettingsSave(nextSettings);
  };

  const getTouchDistance = (t0: IframeTouch, t1: IframeTouch) => {
    // Use screenX/screenY instead of clientX/clientY because pinchZoom
    // applies a CSS transform to the iframe's parent, which changes the
    // iframe's coordinate space and causes clientX/clientY to oscillate
    const dx = t1.screenX - t0.screenX;
    const dy = t1.screenY - t0.screenY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const onTouchStart = (e: IframeTouchEvent | React.TouchEvent<HTMLDivElement>) => {
    const t0 = e.targetTouches[0] as IframeTouch | undefined;
    const t1 = e.targetTouches[1] as IframeTouch | undefined;
    if (t0 && t1) {
      const bookData = getBookData(bookKey);
      if (bookData?.isFixedLayout) {
        isPinchingRef.current = true;
        initialPinchDistRef.current = getTouchDistance(t0, t1);
        initialZoomRef.current = getViewSettings(bookKey)?.zoomLevel ?? 100;
        lastPinchRatioRef.current = 1;
        brightnessGestureRef.current = null;
        colorTemperatureGestureRef.current = null;
        touchStartRef.current = null;
        touchEndRef.current = null;
        return;
      }
    }
    if (!t0) return;
    touchStartRef.current = t0;
    touchStartTimeRef.current = 'timeStamp' in e ? e.timeStamp : Date.now();
    brightnessGestureRef.current =
      appService?.isIOSApp && e.targetTouches.length === 1
        ? {
            initialValue:
              settingsRef.current.screenBrightness >= 0 ? settingsRef.current.screenBrightness : 50,
            active: false,
          }
        : null;
    colorTemperatureGestureRef.current =
      appService?.isIOSApp && e.targetTouches.length === 2
        ? {
            initialValue: settingsRef.current.screenColorTemperature ?? 0,
            startX: (t0.screenX + (t1?.screenX ?? t0.screenX)) / 2,
            startY: (t0.screenY + (t1?.screenY ?? t0.screenY)) / 2,
            active: false,
          }
        : null;
  };

  const onTouchMove = (e: IframeTouchEvent | React.TouchEvent<HTMLDivElement>) => {
    const t0 = e.targetTouches[0] as IframeTouch | undefined;
    const t1 = e.targetTouches[1] as IframeTouch | undefined;
    if (isPinchingRef.current && t0 && t1) {
      const currentDist = getTouchDistance(t0, t1);
      if (initialPinchDistRef.current > 0) {
        const ratio = currentDist / initialPinchDistRef.current;
        lastPinchRatioRef.current = ratio;
        const renderer = getView(bookKey)?.renderer;
        renderer?.pinchZoom?.(ratio);
      }
      return;
    }
    if (appService?.isIOSApp && t0) {
      const currentTouchCount = e.targetTouches.length;
      const bookData = getBookData(bookKey);
      const viewSettings = getViewSettings(bookKey);
      const gestureFullRange = Math.max(window.innerHeight * GESTURE_FULL_RANGE_HEIGHT_FACTOR, 160);

      if (
        currentTouchCount === 2 &&
        colorTemperatureGestureRef.current &&
        touchStartRef.current &&
        viewSettings &&
        !bookData?.isFixedLayout
      ) {
        const secondTouch = t1;
        if (secondTouch) {
          const startY = colorTemperatureGestureRef.current.startY;
          const startX = colorTemperatureGestureRef.current.startX;
          const currentY = (t0.screenY + secondTouch.screenY) / 2;
          const currentX = (t0.screenX + secondTouch.screenX) / 2;
          const deltaY = currentY - startY;
          const deltaX = currentX - startX;
          const gesture = colorTemperatureGestureRef.current;
          if (
            gesture.active ||
            (Math.abs(deltaY) >= GESTURE_ACTIVATION_THRESHOLD &&
              Math.abs(deltaY) > Math.abs(deltaX) * 1.2)
          ) {
            gesture.active = true;
            setHoveredBookKey(null);
            applyColorTemperatureGestureValue(gesture.initialValue - (deltaY / gestureFullRange) * 200);
            touchEndRef.current = t0;
            touchEndTimeRef.current = 'timeStamp' in e ? e.timeStamp : Date.now();
            return;
          }
        }
      }

      if (
        currentTouchCount === 1 &&
        brightnessGestureRef.current &&
        touchStartRef.current &&
        viewSettings &&
        !viewSettings.scrolled &&
        !viewSettings.vertical &&
        !bookData?.isFixedLayout
      ) {
        const deltaY = t0.screenY - touchStartRef.current.screenY;
        const deltaX = t0.screenX - touchStartRef.current.screenX;
        const gesture = brightnessGestureRef.current;
        if (
          gesture.active ||
          (Math.abs(deltaY) >= GESTURE_ACTIVATION_THRESHOLD &&
            Math.abs(deltaY) > Math.abs(deltaX) * 1.2)
        ) {
          gesture.active = true;
          setHoveredBookKey(null);
          applyBrightnessGestureValue(gesture.initialValue - (deltaY / gestureFullRange) * 100);
          touchEndRef.current = t0;
          touchEndTimeRef.current = 'timeStamp' in e ? e.timeStamp : Date.now();
          return;
        }
      }
    }
    if (!touchStartRef.current) return;
    const touch = t0;
    if (touch) {
      touchEndRef.current = touch;
      touchEndTimeRef.current = 'timeStamp' in e ? e.timeStamp : Date.now();
    }
    const { current: touchStart } = touchStartRef;
    const { current: touchEnd } = touchEndRef;
    if (hoveredBookKey && touchEnd) {
      const viewSettings = getViewSettings(bookKey)!;
      const deltaY = touchEnd.screenY - touchStart.screenY;
      const deltaX = touchEnd.screenX - touchStart.screenX;
      if (!viewSettings!.scrolled && !viewSettings!.vertical) {
        if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
          setHoveredBookKey(null);
        }
      } else {
        setHoveredBookKey(null);
      }
    }
  };

  const onTouchEnd = (e: IframeTouchEvent | React.TouchEvent<HTMLDivElement>) => {
    if (isPinchingRef.current) {
      const t0 = e.targetTouches[0] as IframeTouch | undefined;
      const t1 = e.targetTouches[1] as IframeTouch | undefined;
      if (t0 && t1) return; // still pinching with 2+ fingers
      isPinchingRef.current = false;
      const renderer = getView(bookKey)?.renderer;
      if (renderer && initialPinchDistRef.current > 0) {
        renderer.pinchEnd?.();
        const newZoom = Math.round(initialZoomRef.current * lastPinchRatioRef.current);
        const clampedZoom = Math.max(MIN_ZOOM_LEVEL, Math.min(MAX_ZOOM_LEVEL, newZoom));
        eventDispatcher.dispatch('pinch-zoom', { zoomLevel: clampedZoom });
      }
      touchStartRef.current = null;
      touchEndRef.current = null;
      brightnessGestureRef.current = null;
      colorTemperatureGestureRef.current = null;
      return;
    }
    if (brightnessGestureRef.current?.active || colorTemperatureGestureRef.current?.active) {
      touchStartRef.current = null;
      touchEndRef.current = null;
      brightnessGestureRef.current = null;
      colorTemperatureGestureRef.current = null;
      return;
    }
    if (!touchStartRef.current) return;

    const touch = e.targetTouches[0];
    if (touch) {
      touchEndRef.current = touch;
      touchEndTimeRef.current = 'timeStamp' in e ? e.timeStamp : Date.now();
    }

    const windowWidth = window.innerWidth;
    const { current: touchStart } = touchStartRef;
    const { current: touchEnd } = touchEndRef;
    const { current: touchStartTime } = touchStartTimeRef;
    const { current: touchEndTime } = touchEndTimeRef;
    if (touchEnd) {
      const viewSettings = getViewSettings(bookKey)!;
      const bookData = getBookData(bookKey)!;
      const deltaY = touchEnd.screenY - touchStart.screenY;
      const deltaX = touchEnd.screenX - touchStart.screenX;
      const deltaT = touchEndTime && touchStartTime ? touchEndTime - touchStartTime : 0;
      // also check for deltaX to prevent swipe page turn from triggering the toggle
      if (
        deltaY < -10 &&
        Math.abs(deltaY) > Math.abs(deltaX) * 2 &&
        Math.abs(deltaX) < windowWidth * 0.3
      ) {
        // swipe up to toggle the header bar and the footer bar, only for horizontal page mode
        if (
          !viewSettings!.scrolled && // not scrolled
          !viewSettings!.vertical && // not vertical
          (!bookData.isFixedLayout || viewSettings.zoomLevel <= 100) // for fixed layout, not when zoomed in
        ) {
          setHoveredBookKey(hoveredBookKey ? null : bookKey);
        }
      } else {
        if (hoveredBookKey) {
          setHoveredBookKey(null);
        }
      }
      handlePageFlip(
        new CustomEvent('touch-swipe', {
          detail: {
            deltaX,
            deltaY,
            deltaT,
            startX: touchStart.screenX,
            startY: touchStart.screenY,
            endX: touchEnd.screenX,
            endY: touchEnd.screenY,
          },
        }),
      );
      handleContinuousScroll('touch', deltaY, 30);
    }

    touchStartRef.current = null;
    touchEndRef.current = null;
    brightnessGestureRef.current = null;
    colorTemperatureGestureRef.current = null;
  };

  const handleTouch = (msg: MessageEvent) => {
    if (msg.data && msg.data.bookKey === bookKey) {
      if (msg.data.type === 'iframe-touchstart') {
        onTouchStart(msg.data);
      } else if (msg.data.type === 'iframe-touchmove') {
        onTouchMove(msg.data);
      } else if (msg.data.type === 'iframe-touchend') {
        onTouchEnd(msg.data);
      }
    }
  };

  useEffect(() => {
    window.addEventListener('message', handleTouch);
    return () => {
      window.removeEventListener('message', handleTouch);
      if (pendingSettingsSaveRef.current) {
        clearTimeout(pendingSettingsSaveRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoveredBookKey]);

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
  };
};
