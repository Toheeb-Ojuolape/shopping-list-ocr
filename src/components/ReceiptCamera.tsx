import { ActionIcon } from '@mantine/core'
import { IconCamera } from '@tabler/icons-react'
import { useEffect, useRef, useState } from 'react'

type ReceiptCameraProps = {
  onCapture: (dataUri: string) => void
  onError: (error: Error) => void
}

export function ReceiptCamera({ onCapture, onError }: ReceiptCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    let stream: MediaStream | undefined
    let isMounted = true

    async function startCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        onError(new Error('Camera access needs localhost, HTTPS, and a supported browser.'))
        return
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1440 },
            height: { ideal: 1920 },
          },
        })

        if (videoRef.current && isMounted) {
          videoRef.current.srcObject = stream
          setIsReady(true)
        }
      } catch (error) {
        if (isMounted) {
          onError(error instanceof Error ? error : new Error('Camera unavailable.'))
        }
      }
    }

    startCamera()

    return () => {
      isMounted = false
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [onError])

  function captureFrame() {
    const video = videoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) {
      onError(new Error('Camera is still warming up.'))
      return
    }

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) {
      onError(new Error('Could not capture a camera frame.'))
      return
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    onCapture(canvas.toDataURL('image/jpeg', 0.92))
  }

  return (
    <div className="live-camera">
      <video ref={videoRef} autoPlay muted playsInline />
      <ActionIcon
        type="button"
        className="shutter-button"
        disabled={!isReady}
        onClick={captureFrame}
        aria-label="Capture receipt"
        color="receiptRed"
      >
        <IconCamera size={30} stroke={2.2} />
      </ActionIcon>
    </div>
  )
}
