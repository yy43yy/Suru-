def calculate_rhr_score(base_rhr, today_rhr):
    difference = (today_rhr - base_rhr) / base_rhr * 100

    if difference <= 0:
        return 100
    elif difference <= 3:
        return 90
    elif difference <= 6:
        return 75
    elif difference <= 10:
        return 50
    else:
        return 25