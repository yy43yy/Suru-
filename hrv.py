def calculate_hrv_score(base_hrv, today_hrv):
    difference = (today_hrv - base_hrv) / base_hrv * 100

    if difference >= 5:
        return 100
    elif difference >= -5:
        return 90
    elif difference >= -10:
        return 75
    elif difference >= -20:
        return 55
    else:
        return 30