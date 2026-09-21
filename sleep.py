def calculate_sleep_score(sleep_hours):
    if(sleep_hours>=8):
        return 100
    elif(sleep_hours>=7):
        return 85
    elif(sleep_hours>=6):
        return 65
    elif(sleep_hours>=5):
        return 40
    else:
        return 20