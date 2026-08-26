# -*- coding: utf-8 -*-
"""
读取最新天气的小工具
使用 Open-Meteo 免费天气 API（无需 API 密钥，无需注册）
数据来源：https://open-meteo.com/
"""

import urllib.request
import json

# WMO 天气代码 -> 中文描述
WEATHER_CODE = {
    0: "晴朗",
    1: "大部晴朗",
    2: "局部多云",
    3: "阴天",
    45: "雾",
    48: "雾凇",
    51: "小毛毛雨",
    53: "毛毛雨",
    55: "大毛毛雨",
    56: "冻毛毛雨",
    57: "强冻毛毛雨",
    61: "小雨",
    63: "中雨",
    65: "大雨",
    66: "冻雨",
    67: "强冻雨",
    71: "小雪",
    73: "中雪",
    75: "大雪",
    77: "雪粒",
    80: "小阵雨",
    81: "中阵雨",
    82: "强阵雨",
    85: "小阵雪",
    86: "强阵雪",
    95: "雷暴",
    96: "雷暴伴小冰雹",
    99: "雷暴伴大冰雹",
}


def get_weather(latitude, longitude):
    """根据经纬度获取最新天气信息"""
    base_url = "https://api.open-meteo.com/v1/forecast"
    # 请求实时天气数据
    url = (
        f"{base_url}"
        f"?latitude={latitude}&longitude={longitude}"
        f"&current_weather=true&timezone=auto"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    current = data["current_weather"]
    code = current["weathercode"]
    desc = WEATHER_CODE.get(code, f"未知(代码{code})")

    return {
        "城市坐标": f"{latitude}, {longitude}",
        "观测时间": current["time"],
        "天气": desc,
        "温度": f"{current['temperature']}°C",
        "风速": f"{current['windspeed']} km/h",
        "风向": f"{current['winddirection']}°",
        "是否白天": "是" if current["is_day"] else "否",
    }


def main():
    # 默认查询北京（可自行修改经纬度）
    latitude = 39.9042
    longitude = 116.4074

    print(f"正在查询天气（{latitude}, {longitude}）...\n")
    try:
        info = get_weather(latitude, longitude)
        for key, value in info.items():
            print(f"{key}: {value}")
    except Exception as e:
        print(f"获取天气失败：{e}")


if __name__ == "__main__":
    main()
