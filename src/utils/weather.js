/**
 * Fetches current weather for a location using Open-Meteo — a free
 * weather API that requires no API key or signup, unlike most
 * weather services. Good fit for an MVP.
 */
export async function getCurrentWeather(lat, lng) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,precipitation,weather_code,wind_speed_10m`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Weather API returned ${response.status}`);
    }
    const data = await response.json();
    return data.current;
  } catch (err) {
    console.error("Weather fetch failed:", err.message);
    return null; // never let a weather failure break risk scoring
  }
}

/**
 * Open-Meteo returns a numeric "weather code" (WMO standard) rather
 * than a plain description. This maps the codes that matter for
 * safety risk into a simple category we can reason about.
 * Full code reference: https://open-meteo.com/en/docs
 */
export function classifyWeatherRisk(weatherData) {
  if (!weatherData) return { isRisky: false, description: null };

  const code = weatherData.weather_code;
  const windSpeed = weatherData.wind_speed_10m;

  // Codes 95-99: thunderstorm. 65: heavy rain. 75: heavy snow. 82: violent rain showers.
  const severeCodes = [65, 75, 82, 95, 96, 99];
  const isRisky = severeCodes.includes(code) || windSpeed > 40; // 40 km/h+ wind

  const descriptions = {
    65: "Heavy rain",
    75: "Heavy snow",
    82: "Violent rain showers",
    95: "Thunderstorm",
    96: "Thunderstorm with hail",
    99: "Severe thunderstorm with hail",
  };

  return {
    isRisky,
    description: descriptions[code] ?? (windSpeed > 40 ? "High winds" : "Clear conditions"),
  };
}