import { getLogger } from '@agentx/shared';

export interface WeatherConditions {
  temperature: number;
  windSpeed: number;
  windDirection: number;
  weatherCode: number;
  isDay: boolean;
  time: string;
}

export interface WeatherResponse {
  location: { latitude: number; longitude: number };
  current: WeatherConditions;
  url: string;
}

export class WeatherService {
  private cache = new Map<string, { at: number; data: WeatherResponse }>();
  private readonly cacheTtlMs = 5 * 60_000;
  private readonly baseUrl = 'https://api.open-meteo.com/v1/forecast';

  async getCurrentWeather(latitude: number, longitude: number): Promise<WeatherResponse | null> {
    const key = `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < this.cacheTtlMs) return cached.data;

    const url = `${this.baseUrl}?latitude=${latitude}&longitude=${longitude}&current_weather=true`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`Open-Meteo returned ${res.status}`);
      const body = await res.json() as {
        current_weather?: {
          temperature: number;
          windspeed: number;
          winddirection: number;
          weathercode: number;
          is_day: number;
          time: string;
        };
        latitude: number;
        longitude: number;
      };
      const cw = body.current_weather;
      if (!cw) return null;
      const data: WeatherResponse = {
        location: { latitude: body.latitude, longitude: body.longitude },
        current: {
          temperature: cw.temperature,
          windSpeed: cw.windspeed,
          windDirection: cw.winddirection,
          weatherCode: cw.weathercode,
          isDay: cw.is_day === 1,
          time: cw.time,
        },
        url,
      };
      this.cache.set(key, { at: Date.now(), data });
      return data;
    } catch (err) {
      getLogger().warn('WEATHER', `Failed to fetch weather: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
}

let instance: WeatherService | null = null;

export function getWeatherService(): WeatherService {
  if (!instance) instance = new WeatherService();
  return instance;
}

export function resetWeatherService(): void {
  instance = null;
}
