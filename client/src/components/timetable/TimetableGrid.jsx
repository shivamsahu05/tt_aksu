import React from 'react';

const TimetableGrid = ({ timetable, sessionId, sectionId, sectionInfo, onRefresh }) => {
    return (
        <div style={{ padding: '20px', background: '#fff', border: '1px solid var(--app-border)', borderRadius: '8px' }}>
            <h4>Timetable for {sectionInfo ? sectionInfo.section_name : 'Selected Section'}</h4>
            {timetable && timetable.length > 0 ? (
                <div style={{ overflowX: 'auto', marginTop: '20px' }}>
                    <table className="table table-bordered">
                        <thead>
                            <tr>
                                <th>Day \\ Time</th>
                                <th>Schedule</th>
                            </tr>
                        </thead>
                        <tbody>
                            {/* This is a simplified view to prevent crashes. The full grid should map days to slots. */}
                            {timetable.map(entry => (
                                <tr key={entry.id}>
                                    <td>{entry.day_name}</td>
                                    <td>
                                        <strong>{entry.subject}</strong><br/>
                                        <small>{entry.teacher}</small><br/>
                                        <small className="text-muted">{entry.room} ({entry.start_time} - {entry.end_time})</small>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
                    No timetable data found for this section.
                </div>
            )}
        </div>
    );
};

export default TimetableGrid;
