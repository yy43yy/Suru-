def calculate_subjective_score(rating):
    if rating == 1:
        return 100
    elif rating == 2:
        return 80
    elif rating == 3:
        return 60
    elif rating == 4:
        return 35
    else:
        return 10