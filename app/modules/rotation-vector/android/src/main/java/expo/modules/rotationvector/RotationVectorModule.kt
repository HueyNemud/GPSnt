// SPDX-License-Identifier: AGPL-3.0-or-later
package expo.modules.rotationvector

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val ROTATION_EVENT = "onRotation"
private const val ACCURACY_EVENT = "onAccuracy"

/**
 * Exposes Android's orientation fusion (TYPE_ROTATION_VECTOR) as a quaternion.
 *
 * The quaternion q = [w, x, y, z] maps the device frame (x right, y top of the screen, z out of
 * the screen) to the ENU world frame (x East, y magnetic North, z Up):
 *     v_world = q · v_device · q*
 *
 * "Game" mode uses TYPE_GAME_ROTATION_VECTOR (no magnetometer): relative heading, immune to
 * magnetic disturbances but slowly drifting.
 */
class RotationVectorModule : Module(), SensorEventListener {
  private var sensorManager: SensorManager? = null
  private var useGameRotation = false
  private var samplingPeriodUs = 20_000
  private var observing = false
  private val quaternion = FloatArray(4)

  override fun definition() = ModuleDefinition {
    Name("GpsntRotationVector")

    Events(ROTATION_EVENT, ACCURACY_EVENT)

    Function("isAvailable") { game: Boolean ->
      manager().getDefaultSensor(sensorType(game)) != null
    }

    Function("configure") { game: Boolean, periodMs: Int ->
      useGameRotation = game
      samplingPeriodUs = periodMs * 1000
      if (observing) {
        stop()
        start()
      }
    }

    OnStartObserving(ROTATION_EVENT) {
      observing = true
      start()
    }

    OnStopObserving(ROTATION_EVENT) {
      observing = false
      stop()
    }

    OnDestroy {
      stop()
    }
  }

  private fun manager(): SensorManager {
    sensorManager?.let { return it }
    val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
    val m = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    sensorManager = m
    return m
  }

  private fun sensorType(game: Boolean) =
    if (game) Sensor.TYPE_GAME_ROTATION_VECTOR else Sensor.TYPE_ROTATION_VECTOR

  private fun start() {
    val m = manager()
    val sensor = m.getDefaultSensor(sensorType(useGameRotation)) ?: return
    m.registerListener(this, sensor, samplingPeriodUs)
  }

  private fun stop() {
    sensorManager?.unregisterListener(this)
  }

  override fun onSensorChanged(event: SensorEvent) {
    SensorManager.getQuaternionFromVector(quaternion, event.values)
    // values[4]: estimated heading accuracy in radians (-1 if unavailable, absent in game mode)
    val headingAccuracy = if (event.values.size > 4) event.values[4].toDouble() else -1.0
    sendEvent(
      ROTATION_EVENT,
      mapOf(
        "w" to quaternion[0].toDouble(),
        "x" to quaternion[1].toDouble(),
        "y" to quaternion[2].toDouble(),
        "z" to quaternion[3].toDouble(),
        "headingAccuracy" to headingAccuracy,
        "game" to useGameRotation,
        "timestamp" to event.timestamp / 1_000_000_000.0
      )
    )
  }

  override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) {
    // SensorManager.SENSOR_STATUS_*: 0 unreliable, 1 low, 2 medium, 3 high
    sendEvent(ACCURACY_EVENT, mapOf("accuracy" to accuracy))
  }
}
